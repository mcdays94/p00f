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
  // Creator opt-in: require a human Turnstile token to reveal (ADR-0015).
  // Default false, so a poof is revealable by anyone with the link, including a
  // headless agent (and a PIN poof is revealable by an agent that has the PIN).
  requireTurnstile?: boolean;
  ownerHash?: string;
  ownerSalt?: string;
  inlineMax?: number; // content larger than this goes to R2
}

export type MetaResult =
  | { exists: false }
  | {
      exists: true;
      metadata: Uint8Array;
      revealsRemaining: number | null; // null = unlimited
      pinRequired: boolean;
      turnstileRequired: boolean;
      size: number;
    };

export type RevealResult =
  | { ok: true; content: Uint8Array }
  | {
      ok: false;
      reason: "gone" | "pin_required" | "bad_pin" | "locked" | "turnstile_required";
      attemptsLeft?: number;
    };

// Discriminated result for owner-gated burn (ADR-0008). The "gone" reason is
// not an error: a 1-reveal clip is lazily burned at reveal time, so by the
// time the creator clicks "delete now" the row is already missing. Only an
// owner-token mismatch is genuinely forbidden.
export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "gone" | "forbidden" };

interface Row {
  expires_at: number;
  reveal_budget: number;
  reveals_used: number;
  size: number;
  metadata: ArrayBuffer;
  content: ArrayBuffer | null;
  r2_key: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_iters: number | null;
  pin_attempts: number;
  locked_until: number;
  owner_hash: string | null;
  owner_salt: string | null;
  require_turnstile: number;
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
    owner_salt TEXT,
    require_turnstile INTEGER NOT NULL DEFAULT 0
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
    // Additive migration (ADR-0015): clip rows created before require_turnstile
    // existed lack the column. ADD COLUMN brings them up to date; the duplicate-
    // column guard makes it idempotent so it is safe to run on every instance.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE clip ADD COLUMN require_turnstile INTEGER NOT NULL DEFAULT 0",
      );
    } catch (e) {
      if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
    }
  }

  // Reads the single clip row. Resilient to the table being dropped by a prior
  // burn() within the same instance lifetime.
  private row(): Row | null {
    try {
      const rows = this.ctx.storage.sql
        .exec<Row>(
          "SELECT expires_at, reveal_budget, reveals_used, size, metadata, content, r2_key, pin_hash, pin_salt, pin_iters, pin_attempts, locked_until, owner_hash, owner_salt, require_turnstile FROM clip WHERE id = 1",
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

    // Large content goes to R2 as ciphertext; small content stays inline in the
    // DO (ADR-0006). The DO holds the R2 key and proxies bytes on reveal.
    const inlineMax = input.inlineMax ?? Number.POSITIVE_INFINITY;
    let contentBlob: Uint8Array | null = input.content;
    let r2Key: string | null = null;
    if (input.content.byteLength > inlineMax) {
      r2Key = "c/" + randomSaltB64();
      await this.env.R2.put(r2Key, input.content);
      contentBlob = null;
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO clip (id, created_at, expires_at, reveal_budget, reveals_used, size, metadata, content, r2_key, pin_hash, pin_salt, pin_iters, owner_hash, owner_salt, require_turnstile) VALUES (1, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      now,
      expiresAt,
      input.revealBudget,
      input.size,
      input.metadata,
      contentBlob,
      r2Key,
      pinHash,
      pinSalt,
      pinIters,
      input.ownerHash ?? null,
      input.ownerSalt ?? null,
      input.requireTurnstile ? 1 : 0,
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
    // expires_at is intentionally NOT returned: the deadline lives in the
    // encrypted metadata now (ADR-0014). The DO still uses row.expires_at above
    // to enforce the Burn and to schedule the alarm.
    return {
      exists: true,
      metadata: new Uint8Array(row.metadata),
      revealsRemaining,
      pinRequired: row.pin_hash != null,
      turnstileRequired: row.require_turnstile === 1,
      size: row.size,
    };
  }

  async reveal(pin?: string, turnstileVerified?: boolean): Promise<RevealResult> {
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

    // Reveal-Turnstile gate (ADR-0015), opt-in per clip. Checked before the PIN
    // gate and before any budget spend, so a refused reveal is non-consuming.
    // The Worker verifies the token (network + secret) and passes the boolean.
    if (row.require_turnstile === 1 && !turnstileVerified) {
      return { ok: false, reason: "turnstile_required" };
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

    let content: Uint8Array;
    if (row.content) {
      content = new Uint8Array(row.content);
    } else if (row.r2_key) {
      const obj = await this.env.R2.get(row.r2_key);
      if (!obj) return { ok: false, reason: "gone" };
      content = new Uint8Array(await obj.arrayBuffer());
    } else {
      return { ok: false, reason: "gone" };
    }
    const used = row.reveals_used + 1;
    if (row.reveal_budget >= 0 && used >= row.reveal_budget) {
      await this.burn();
    } else {
      this.ctx.storage.sql.exec("UPDATE clip SET reveals_used = ? WHERE id = 1", used);
    }
    return { ok: true, content };
  }

  // Owner-gated early burn (ADR-0008). The owner token never travels in the
  // Link, so a link-holder cannot destroy the clip. A missing row means the
  // clip is already gone (lazily burned at reveal time, TTL alarm, or never
  // existed); we surface that as "gone" rather than "forbidden" so the UI can
  // tell the creator "already burned" instead of a misleading "delete failed."
  // A row that lost its owner_hash/owner_salt cannot be verified, so it is
  // treated as forbidden.
  async deleteWithOwner(token: string): Promise<DeleteResult> {
    const row = this.row();
    if (!row) return { ok: false, reason: "gone" };
    if (!row.owner_hash || !row.owner_salt) return { ok: false, reason: "forbidden" };
    const candidate = await sha256B64(row.owner_salt + token);
    if (candidate !== row.owner_hash) return { ok: false, reason: "forbidden" };
    await this.burn();
    return { ok: true };
  }

  // Permanent destruction: cancel the alarm and clear storage. The DELETE is
  // the load-bearing step; storage.deleteAll() does not reliably clear SQLite
  // table rows across runtimes (ADR-0002, ADR-0006).
  async burn(): Promise<void> {
    const row = this.row();
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // no alarm scheduled
    }
    if (row?.r2_key) {
      try {
        await this.env.R2.delete(row.r2_key);
      } catch {
        // best-effort R2 cleanup
      }
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
