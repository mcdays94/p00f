import type { ClipDO } from "./clip-do";

// The GA Workers ratelimit binding (ADR-0011). Optional so the worker still runs
// (and tests pass) when the binding is not configured.
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  CLIP: DurableObjectNamespace<ClipDO>;
  R2: R2Bucket;
  ASSETS: Fetcher;
  TURNSTILE_SECRET: string;
  MAX_CLIP_BYTES: string;
  INLINE_MAX_BYTES: string;
  CREATE_LIMIT?: RateLimiter;
}
