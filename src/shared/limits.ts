// Byte limits shared by the Worker (authoritative enforcement) and the clients
// (web + CLI), so the cap is defined once and a caller can warn before wasting
// an upload. The wrangler.jsonc env vars MAX_CLIP_BYTES / INLINE_MAX_BYTES
// override the Worker's values at deploy time; these constants are the in-code
// source of truth, the Worker's fallback when an env var is unset, and the
// clients' reference for the pre-flight check and friendly messages.
//
// The cap is bounded by the Worker buffering the entire upload in a ~128 MiB
// isolate before streaming to R2 (ADR-0006), so 25 MiB leaves comfortable
// headroom; materially higher needs streamed / presigned R2 uploads.
export const MAX_CLIP_BYTES = 25 * 1024 * 1024; // 25 MiB hard cap
export const INLINE_MAX_BYTES = 1024 * 1024; // 1 MiB: at or below stays inline in the DO, above goes to R2

// Friendly byte size for limit messages, e.g. "25 MB", "1.5 MB", "900 KB".
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

// TTL and reveal-budget bounds (#22). Creators can pick a custom TTL and a custom
// reveal count, not only the quick-pick presets, so these bounds are the single
// source of truth shared by the Worker (authoritative), the web client, and the
// CLI. They are deliberately tunable policy knobs: raise MAX_TTL_MS for longer
// retention, MAX_REVEAL_BUDGET for more reveals.
export const MIN_TTL_MS = 60_000; // 1 minute floor (below this is not useful for sharing)
export const MAX_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days ceiling (storage + burn-alarm cost)
export const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
export const MAX_REVEAL_BUDGET = 100; // -1 = unlimited; otherwise 1..100
export const DEFAULT_REVEAL_BUDGET = 1;

// Clamp a TTL in ms into [MIN_TTL_MS, MAX_TTL_MS]. A non-finite or non-positive
// value (missing or garbage input) falls back to the default rather than throwing,
// so a bad form field can never block a create.
export function clampTtlMs(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(v)));
}

// Clamp a reveal budget: -1 means unlimited; otherwise 1..MAX_REVEAL_BUDGET. A
// non-finite or sub-1 value (other than -1) falls back to the default.
export function clampRevealBudget(v: number): number {
  if (v === -1) return -1;
  if (!Number.isFinite(v) || v < 1) return DEFAULT_REVEAL_BUDGET;
  return Math.min(MAX_REVEAL_BUDGET, Math.round(v));
}
