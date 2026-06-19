import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export interface CreateInput {
  metadata: Uint8Array;
  content: Uint8Array;
  ttlMs: number;
  revealBudget: number; // -1 = unlimited
  size: number;
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
  | { ok: false; reason: "gone" };

interface Row {
  expires_at: number;
  reveal_budget: number;
  reveals_used: number;
  size: number;
  metadata: ArrayBuffer;
  content: ArrayBuffer | null;
  pin_hash: string | null;
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
  // burn() (deleteAll) within the same instance lifetime.
  private row(): Row | null {
    try {
      const rows = this.ctx.storage.sql
        .exec<Row>(
          "SELECT expires_at, reveal_budget, reveals_used, size, metadata, content, pin_hash FROM clip WHERE id = 1",
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
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO clip (id, created_at, expires_at, reveal_budget, reveals_used, size, metadata, content) VALUES (1, ?, ?, ?, 0, ?, ?, ?)",
      now,
      expiresAt,
      input.revealBudget,
      input.size,
      input.metadata,
      input.content,
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

  async reveal(): Promise<RevealResult> {
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

  // Permanent destruction: cancel the alarm and clear all storage, which also
  // lets the system reclaim the object (ADR-0002, ADR-0006).
  async burn(): Promise<void> {
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // no alarm scheduled
    }
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.burn();
  }
}
