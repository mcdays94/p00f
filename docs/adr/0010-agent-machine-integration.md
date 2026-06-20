# 0010 - Agent and machine integration: one caller-side core, many shells, ciphertext-only API

**Status:** accepted

p00f's value beyond the browser is letting humans and agents create and read Clips from the CLI, an MCP server, and Code Mode agents while keeping the zero-knowledge guarantee of ADR-0001. The decision: all encryption and decryption happen caller-side inside a single shared core; every integration surface (web app, CLI, local MCP server, Code Mode module) is a thin shell over that core; and the hosted p00f API only ever receives ciphertext. We chose this over a hosted MCP or Code Mode server that decrypts, because that design puts the Fragment Key on infrastructure p00f operates, which is exactly the server-trust model ADR-0001 rejected.

## Considered options

- **Hosted MCP / Code Mode server that decrypts.** Rejected. To decrypt, the Fragment Key must be delivered into a Worker p00f deploys, so the operator becomes able to read it. Cloudflare Code Mode (`@cloudflare/codemode`, `DynamicWorkerExecutor` over a `worker_loaders` binding) sandboxes the LLM's generated code from the operator and isolates tenants from each other; it does not make the operator unable to read a key handed to an operator-run isolate (the host Worker marshals inputs into the sandbox and can inject modules). Code Mode relocates where code runs; it does not move the trust boundary.
- **Per-surface crypto implementations.** Rejected. Multiple crypto code paths mean drift and a larger audit surface for the one thing that must be correct.
- **One caller-side core, many shells.** Chosen.

## Decisions

- **`@p00f/core`** is the single zero-knowledge engine: Fragment Key, clip id, and owner-token generation, the HKDF hierarchy and AES-GCM of ADR-0009, Link build and parse, and a ciphertext-only protocol client for the create, meta, reveal, and delete endpoints. It uses Web Crypto only, so it runs in browsers, Node, and workerd.
- **Shells over the core:** the web app (browser), the `poof` CLI (Node), a local stdio MCP server (Node), and a Code Mode module injected into the caller's own executor. None of them reimplement crypto.
- **The agent handoff capability is the full Link** (path id plus Fragment Key). The owner token is never in the Link (ADR-0008), so a link-holder cannot burn the Clip.
- **The hosted API and any hosted MCP facade are ciphertext-only relays.** The Fragment Key never reaches them. For Code Mode specifically, the executor that touches the key is caller-operated, never p00f-operated, even when it also happens to run on Cloudflare.
- **The CLI is stateless.** No local owner-token registry; early burn pastes the owner token back (`poof burn <link> --token ...`).
- **No hosted-decrypt convenience mode.** It is deliberately not offered.

## Consequences

- Zero-knowledge holds identically across web, CLI, MCP, and Code Mode: p00f and Cloudflare are architecturally unable to read plaintext or the Fragment Key.
- The receiving agent, and the LLM behind it, necessarily see the plaintext, because reading the content is the point of a handoff. This is identical to the human who opens a Link today. Zero-knowledge is a statement about the storage operator, not the recipient.
- One crypto implementation to audit and test. The day the CLI and the MCP server both wrap the core with no duplicated logic is the signal the core is factored correctly.
- A hosted-decrypt mode would be the only feature able to read user data, so excluding it keeps the core promise intact.
- Because the hosted API and any remote MCP facade are ciphertext-only, a generic remote MCP client cannot perform a read: it has no way to decrypt. Functional read requires a caller-side shell that holds the Fragment Key (the local stdio MCP server, the CLI, or the Code Mode module). A remote MCP facade is a ciphertext relay only.
- The wire format (KDF salt and info strings, AES-GCM nonce layout, base64url variant, and the envelope schema) is published in the discovery document and `llms.txt`, so a non-SDK caller can implement decryption. `@p00f/core` is the supported reference implementation; raw-HTTP read without it means reimplementing the wire format.
