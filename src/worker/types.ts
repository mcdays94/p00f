import type { ClipDO } from "./clip-do";

export interface Env {
  CLIP: DurableObjectNamespace<ClipDO>;
  R2: R2Bucket;
  ASSETS: Fetcher;
  TURNSTILE_SECRET: string;
  MAX_CLIP_BYTES: string;
  INLINE_MAX_BYTES: string;
}
