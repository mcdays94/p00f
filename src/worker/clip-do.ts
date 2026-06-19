import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export class ClipDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
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
      `);
    });
  }

  // Temporary tracer method (replaced by real methods in POOF-3).
  ping(): string {
    return "pong";
  }
}
