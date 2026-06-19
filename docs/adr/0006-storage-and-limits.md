# 0006 - Storage: one Durable Object per Clip, hybrid inline/R2, 10 MB cap

**Status:** accepted

Each Clip is backed by its own SQLite-backed Durable Object (DO id = clip id), which owns the Clip's entire lifecycle. Content up to ~1 MB is stored inline in the DO; larger content is stored as ciphertext in R2 with the DO holding the key. R2 is a required binding. Clips are capped at 10 MB (deployer-configurable).

## Platform facts that drive this (verified 2026-06-19)

- Durable Objects are available on the Workers **Free** plan, but only with the **SQLite** storage backend (which we use).
- A single SQLite value/BLOB/row cannot exceed **2 MB**. This is the hard reason content above a small size cannot live in the DO.
- Free plan: 5 GB total DO storage, 100k row writes/day, 5M row reads/day. Ephemeral Clips that burn in minutes barely touch these.

## Decisions

- **One Durable Object per Clip.** The DO is the single source of truth and lifecycle owner: metadata blob, reveal budget, PIN hash + lockout state, TTL alarm, and content (inline or R2 key). Single-threaded execution provides the atomic reveal-budget and PIN-attempt counters; the per-object alarm fires the burn.
- **Hybrid content storage.** Content blob ≤ ~1 MB is stored inline in the DO's SQLite (comfortably under the 2 MB ceiling; exact threshold is a build-time tunable). Larger content is stored as ciphertext in **R2**; the DO holds the object key.
- **R2 is required** (option A). One storage story for all content. R2's free tier covers ephemeral blobs; creating a bucket is a wrangler one-liner.
- **Max Clip size: 10 MB**, configurable by the deployer via env var. Larger than ~25 MB would require streaming/multipart upload plus chunked encryption, which is out of v1 scope.
- **Reveal of R2-backed content is proxied through the Worker/DO** after the DO authorizes (budget + PIN). Never a public or presigned R2 URL, because that would bypass budget/PIN/burn enforcement.

## Flow

- **Create:** browser encrypts the metadata and content blobs, POSTs the ciphertext plus a Turnstile token to the Worker. The Worker mints a clip id, routes to the DO, which stores the blobs (inline or to R2), persists the PIN hash if set, and arms the TTL alarm. The Worker returns the id; the client builds the Link as `origin/c/<id>#<fragment key>`. The Fragment Key never reaches the Worker.
- **Burn:** the TTL alarm firing or the reveal budget reaching zero causes the DO to delete its SQLite rows and the R2 object (if any).

## Consequences

- Zero-knowledge holds: R2 and the DO hold only ciphertext.
- Content release is always mediated by the DO, so budget, PIN, and burn are always enforced.
- Storage is cleared promptly on burn, keeping billable DO/R2 storage near zero (relevant once SQLite storage billing begins in January 2026).
