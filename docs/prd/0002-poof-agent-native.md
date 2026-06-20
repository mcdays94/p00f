# PRD 0002 - p00f v2 (agent-native: CLI, MCP, content negotiation)

p00f v1 (PRD 0001) is a finished zero-knowledge, ephemeral clipboard for a human in a browser. v2 extends it along the agent-native axis: humans and agents hand off transient context, secrets, prompts, and intermediate results by URL, from the CLI, an MCP server, and Code Mode agents, while keeping the zero-knowledge spine of ADR-0001. This PRD does not restate the ADRs; it references them. Brand and domain are `p00f.me` (via the Cloudflare Registrar); the repo and code identifiers stay `poof` and `clip`.

## Why

v1 competes in the crowded pastebin and secret-sharing space. The more differentiated and timely opportunity is being the default way humans and AI agents exchange transient information by URL, natively and privately. The brainstormed "memory substrate" vision bundled server-side search, embeddings, and summaries, which are fundamentally incompatible with zero-knowledge (the server would have to read plaintext; see ADR-0001). v2 takes the compatible, high-value half of that vision (typed objects, a JSON-addressable API, and an MCP server) and deliberately leaves the rest out.

## Principles

- **Zero-knowledge everywhere** (ADR-0001, ADR-0010): every surface encrypts and decrypts caller-side; the hosted API holds only ciphertext.
- **One core, many shells** (ADR-0010): a single `@p00f/core` engine; the web app, CLI, MCP server, and Code Mode module are thin wrappers.
- **Anonymous and instant** (ADR-0007, ADR-0011): no signup to create from a browser, the CLI, or an agent.
- **Ephemeral by default** (ADR-0002).
- **Self-hostable on free** (ADR-0005, ADR-0011): the abuse floor ships in-repo via the `ratelimit` binding.
- **Honest about risk**: the trust model is stated plainly, including that the recipient (and the LLM behind it) sees plaintext.

## In scope (v2)

- **`@p00f/core`**: extract the zero-knowledge engine (crypto from `src/shared/crypto.ts`, plus Link build/parse and a ciphertext-only protocol client) into a module that runs in browser, Node, and workerd. The web client becomes a shell over it.
- **Content negotiation**: `GET /c/:id.json` and `Accept: application/json` return the encrypted metadata envelope (non-consuming, ADR-0003); reveal returns the encrypted content (consuming). Add `GET /health` and a machine-readable discovery document at `/` (JSON) plus `llms.txt`.
- **Typed objects**: the API and SDK accept an arbitrary `kind` string stored in the encrypted metadata, so the server never learns it. The web UI renders text, code, image, file, and a new `secret` kind (masked until reveal), with a text-or-download fallback for unknown kinds.
- **`poof` CLI** (stateless, Node, package `@p00f/cli`): default verb create (file path or stdin); `get` (alias `cat`), `info`, `burn`; flags `--ttl`, `--reads`, `--pin`, `--kind`, `--json`, `--copy`. stdout is the Link only; human chrome and the owner token go to stderr.
- **Local MCP server** (stdio, Node): tools `poof_create`, `poof_read`, `poof_info` (non-consuming), `poof_burn`, over the core.
- **Machine-path abuse control** (ADR-0011): the `ratelimit` binding floor on create and reveal; Turnstile stays browser-only.
- **OSS readiness**: LICENSE (MIT), SECURITY.md (trust model and disclosure contact), a README with the trust model and quickstarts, and moving the real Turnstile secret out of `wrangler.jsonc` to `wrangler secret put` before any sync (the documented test key stays as the dev default).

## Out of scope (v2)

- Server-side search, embeddings, summaries, keywords, semantic metadata, and format conversion (incompatible with zero-knowledge, ADR-0001).
- Accounts, OAuth, and human login (ADR-0007). The optional PII-free key (ADR-0011) is designed-for but not built in v2.
- A hosted MCP or Code Mode server that decrypts (ADR-0010).
- Webhooks, and the `list_recent` and `search_objects` MCP tools (not zero-knowledge compatible).
- Paid tiers and monetization (free for now).
- Packaging and distributing the Code Mode injectable module (design-compatible since it is just the core; deferred unless trivial).

## Deep modules (and test coverage)

- **`@p00f/core`** (new deep module): key, id, and owner-token generation, the HKDF hierarchy and AES-GCM (ADR-0009), Link build and parse, and the ciphertext-only protocol client. Heavily unit-tested; the crypto half already is. Web Crypto only, so it runs in Node, workerd, and the browser.
- **`ClipDO`** (unchanged): the lifecycle state machine; now also serves the content-negotiated envelope. Tested under the Workers pool.
- **Worker API**: thin router; adds content negotiation, discovery, health, and the `ratelimit` floor. Integration-tested.
- **`poof` CLI and MCP server**: thin shells over the core; tested via the core plus light shell tests, including an assertion that no Fragment Key ever leaves for the network (mirroring the existing e2e check).

## Definition of done (v2, local)

1. `@p00f/core` is consumed by the web client, the CLI, and the MCP server with no duplicated crypto.
2. `poof file.txt` returns a working `poof.localhost/c/<id>#<key>` Link; `poof get <link>` decrypts and prints; `poof info` is non-consuming; `poof burn <link> --token ...` burns.
3. One MCP client can `poof_create` and another can `poof_read` the Link and decrypt locally; a test asserts the hosted API never receives a Fragment Key.
4. `.json` and `Accept: application/json` return the encrypted envelope (cleartext protocol fields plus the encrypted metadata blob, never plaintext); `/health` and the discovery document respond.
5. The `ratelimit` floor rejects over-limit create and reveal; Turnstile still gates browser create; anonymous CLI create works under the floor.
6. Revealed content renders in an opaque-origin sandbox; an HTML or SVG payload cannot read `location.hash` (tested, ADR-0012).
7. Reveal and envelope responses are `no-store` and bypass cache (tested); a clip past TTL or budget returns 404 or 410 with no cached ciphertext.
8. `vitest run` passes (core, ClipDO, API, CLI/MCP suites); the Playwright flows still pass.

## Hardening and protocol contract

Reconciled from an independent review. Items already settled by earlier ADRs are cited; genuinely new requirements are marked NEW.

- **Reveal is a non-idempotent POST** (`POST /api/clip/:id/reveal`); the bare Link `GET /c/:id` returns only the app shell and `GET /c/:id.json` returns the envelope, both non-consuming (ADR-0002, ADR-0003). This keeps link unfurlers, prefetchers, and scanners from spending reveal budget.
- **Reveal and envelope responses are uncacheable** (NEW): `Cache-Control: no-store, private` and an explicit Cloudflare cache bypass for `/c/*` and `/api/clip/*`, so ciphertext is never served from cache and cannot outlive a Burn.
- **Envelope schema** (NEW, clarifies ADR-0003). The `.json` envelope is a JSON wrapper with two parts: cleartext protocol fields the server already enforces (`id`, `revealsRemaining`, `expiresAt`, `pinRequired`, `hasContent`, a coarse `sizeBucket`) and the encrypted metadata blob (ciphertext: `kind`, `filename`, `mime`, exact size). It never contains plaintext, the Fragment Key, or the exact `kind` or `filename` in cleartext.
- **Published wire format** (NEW): the discovery document and `llms.txt` publish the KDF salt and info strings, the AES-GCM nonce layout, the base64url variant, and the envelope schema, so a non-SDK caller can implement decryption. `@p00f/core` is the supported reference implementation. The wire-format contract is owned by POOF-12 and consumed by POOF-13.
- **Sandboxed rendering** (NEW, ADR-0012): the web app renders revealed content in an opaque-origin sandboxed iframe under a strict CSP; the Fragment Key never enters the sandbox; SVG and unknown kinds are downloads, never inline. This stops an XSS-in-a-Clip from reading `location.hash` and exfiltrating the key.
- **Request hygiene** (NEW): the Worker never logs clip ids or anything key-like; responses set `Referrer-Policy: no-referrer`; content negotiation sets `Vary: Accept`; the JSON API CORS policy is explicit and credential-less, and reveal stays POST so it is not a trivial cross-site GET.
- **Caps** (cite): max TTL 7 days, reveal budget in {1, 3, 10, unlimited-until-expiry}, max content size 10 MB (ADR-0002, ADR-0006); the server rejects over-limit create. Content-length is a known residual leak (ADR-0003); the `secret` kind may be padded to a size bucket.
- **CLI footguns** (NEW): enumerated exit codes (not-found or 410, exhausted, pin-required, pin-wrong, decrypt-failed, rate-limited or 429); `--json` includes the owner token; losing the owner token means only TTL or budget Burn applies (warned); `--pin` prompts or reads an env var rather than only a flag (shell history); `--copy` warns that it places the key in a possibly-syncing clipboard; binary `get` requires `-o FILE` and refuses to write binary to a TTY.
- **MCP footguns** (NEW): `poof_read` of a `secret` kind requires an explicit confirm and emits a warning, because it returns plaintext into the model context; `poof_create` returns the owner token in its result; a remote MCP facade is a ciphertext relay only, so functional read requires the local server that holds the key (ADR-0010).
- **Packaging** (NEW): `@p00f/core` is ESM-only with an `exports` map and types, targets Node >= 20 (global Web Crypto), and is consumed by the CLI and MCP via local workspace linking; no npm publish without an explicit ask.
- **Crypto containment** (NEW): a test and lint rule assert `crypto.subtle` is used only inside `@p00f/core`, and that the web app, CLI, and MCP import crypto from the core.

## Issue slices

Tracer-bullet vertical slices, tracked in `poof-issues.html`:

1. Extract `@p00f/core`; refactor the web client onto it; suite green (POOF-12)
2. Content negotiation, `/health`, and the discovery doc (`/` JSON plus `llms.txt`) (POOF-13)
3. Arbitrary `kind` plus the `secret` kind render (POOF-14)
4. `ratelimit` binding floor on create and reveal; Turnstile stays browser-only (POOF-15)
5. `poof` CLI (stateless): create, get, info, burn, plus flags (POOF-16)
6. Local stdio MCP server: `poof_create`, `poof_read`, `poof_info`, `poof_burn` (POOF-17)
7. OSS readiness: LICENSE (MIT), SECURITY.md, README, Turnstile secret moved to `wrangler secret` (POOF-18)
8. Stretch: Code Mode injectable module packaging (POOF-19)
