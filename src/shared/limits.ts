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
