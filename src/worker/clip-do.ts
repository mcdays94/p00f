import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { pbkdf2B64, randomSaltB64, sha256B64 } from "./hash";

const MAX_PIN_ATTEMPTS = 5;
const PIN_ITERS = 100_000;

export interface CreateInput {
  metadata: Uint8Array;
  content: Uint8Array;
  ttlMs: number;
  revealBudget: number; // -1 = unlimited
  size: number;
  pin?: string;
  ownerHash?: string;
  ownerSalt?: string;
}

export type MetaResult =
  | { exists: false }
  | {
      exists: true;
      metadata: Uint8Array;
      revealsRemaining: number | null; // null = unlimited
      expiresAt: number;
      pinRequired: boolean;
      size: number;
    };

export type RevealResult =
  | { ok: true; content: Uint8Array }
  | { ok: false; reason: "gone" | "pin_required" | "bad_pin" | "locked"; attemptsLeft?: number };

interface Row {
  expires_at: number;
  reveal_budget: number;
  reveals_used: number;
  size: number;
  metadata: ArrayBuffer;
  content: ArrayBuffer | null;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_iters: number | null;
  pin_attempts: number;
  locked_until: number;
  owner_hash: string | null;
  owner_salt: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS clip (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    reveal_budget INTEGER NOT NULL,
    reveals_used INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    metadata BLOB NOT NULL,
    content BLOB,
    r2_key TEXT,
    pin_hash TEXT,
    pin_salt TEXT,
    pin_iters INTEGER,
    pin_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    owner_hash TEXT,
    owner_salt TEXT
  )
`;

export class ClipDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(SCHEMA);
  }

  // Reads the single clip row. Resilient to the table being dropped by a prior
  // burn() within the same instance lifetime.
  private row(): Row | null {
    try {
      const rows = this.ctx.storage.sql
        .exec<Row>(
          "SELECT expires_at, reveal_budget, reveals_used, size, metadata, content, pin_hash, pin_salt, pin_iters, pin_attempts, locked_until, owner_hash, owner_salt FROM clip WHERE id = 1",
        )
        .toArray();
      return rows.length ? rows[0] : null;
    } catch (e) {
      if (e instanceof Error && /no such table/i.test(e.message)) return null;
      throw e;
    }
  }

  async create(input: CreateInput): Promise<{ ok: true }> {
    this.ensureSchema();
    const now = Date.now();
    const expiresAt = now + input.ttlMs;

    let pinHash: string | null = null;
    let pinSalt: string | null = null;
    let pinIters: number | null = null;
    if (input.pin) {
      pinSalt = randomSaltB64();
      pinIters = PIN_ITERS;
      pinHash = await pbkdf2B64(input.pin, pinSalt, pinIters);
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO clip (id, created_at, expires_at, reveal_budget, reveals_used, size, metadata, content, pin_hash, pin_salt, pin_iters, owner_hash, owner_salt) VALUES (1, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)",
      now,
      expiresAt,
      input.revealBudget,
      input.size,
      input.metadata,
      input.content,
      pinHash,
      pinSalt,
      pinIters,
      input.ownerHash ?? null,
      input.ownerSalt ?? null,
    );
    await this.ctx.storage.setAlarm(expiresAt);
    return { ok: true };
  }

  async getMeta(): Promise<MetaResult> {
    const row = this.row();
    if (!row) return { exists: false };
    if (Date.now() >= row.expires_at) {
      await this.burn();
      return { exists: false };
    }
    if (row.reveal_budget >= 0 && row.reveals_used >= row.reveal_budget) {
      await this.burn();
      return { exists: false };
    }
    const revealsRemaining =
      row.reveal_budget < 0 ? null : Math.max(0, row.reveal_budget - row.reveals_used);
    return {
      exists: true,
      metadata: new Uint8Array(row.metadata),
      revealsRemaining,
      expiresAt: row.expires_at,
      pinRequired: row.pin_hash != null,
      size: row.size,
    };
  }

  async reveal(pin?: string): Promise<RevealResult> {
    const row = this.row();
    if (!row) return { ok: false, reason: "gone" };
    if (Date.now() >= row.expires_at) {
      await this.burn();
      return { ok: false, reason: "gone" };
    }
    if (row.reveal_budget >= 0 && row.reveals_used >= row.reveal_budget) {
      await this.burn();
      return { ok: false, reason: "gone" };
    }

    // PIN gate (ADR-0004). Wrong attempts never consume reveal budget; they
    // increment the attempt counter and lock the clip out after the threshold.
    if (row.pin_hash) {
      if (row.locked_until > Date.now()) return { ok: false, reason: "locked" };
      if (!pin) return { ok: false, reason: "pin_required" };
      const candidate = await pbkdf2B64(pin, row.pin_salt as string, row.pin_iters as number);
      if (candidate !== row.pin_hash) {
        const attempts = row.pin_attempts + 1;
        if (attempts >= MAX_PIN_ATTEMPTS) {
          // Lock out for the remainder of the clip's life.
          this.ctx.storage.sql.exec(
            "UPDATE clip SET pin_attempts = ?, locked_until = ? WHERE id = 1",
            attempts,
            row.expires_at,
          );
          return { ok: false, reason: "locked" };
        }
        this.ctx.storage.sql.exec("UPDATE clip SET pin_attempts = ? WHERE id = 1", attempts);
        return { ok: false, reason: "bad_pin", attemptsLeft: MAX_PIN_ATTEMPTS - attempts };
      }
      if (row.pin_attempts !== 0) {
        this.ctx.storage.sql.exec("UPDATE clip SET pin_attempts = 0 WHERE id = 1");
      }
    }

    if (!row.content) return { ok: false, reason: "gone" };

    const content = new Uint8Array(row.content);
    const used = row.reveals_used + 1;
    if (row.reveal_budget >= 0 && used >= row.reveal_budget) {
      await this.burn();
    } else {
      this.ctx.storage.sql.exec("UPDATE clip SET reveals_used = ? WHERE id = 1", used);
    }
    return { ok: true, content };
  }

  // Owner-gated early burn (ADR-0008). The owner token never travels in the
  // Link, so a link-holder cannot destroy the clip.
  async deleteWithOwner(token: string): Promise<{ ok: boolean }> {
    const row = this.row();
    if (!row || !row.owner_hash || !row.owner_salt) return { ok: false };
    const candidate = await sha256B64(row.owner_salt + token);
    if (candidate !== row.owner_hash) return { ok: false };
    await this.burn();
    return { ok: true };
  }

  // Permanent destruction: cancel the alarm and clear storage. The DELETE is
  // the load-bearing step; storage.deleteAll() does not reliably clear SQLite
  // table rows across runtimes (ADR-0002, ADR-0006).
  async burn(): Promise<void> {
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // no alarm scheduled
    }
    try {
      this.ctx.storage.sql.exec("DELETE FROM clip");
    } catch {
      // table already gone
    }
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.burn();
  }
}
