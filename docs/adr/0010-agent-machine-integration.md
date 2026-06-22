# 0010 - Agent and machine integration: one caller-side core, many shells, ciphertext-only API

**Status:** accepted

p00f's value beyond the browser is letting humans and agents create and read Clips from the CLI while keeping the zero-knowledge guarantee of ADR-0001. The decision: all encryption and decryption happen caller-side inside a single shared core; every integration surface (web app, CLI) is a thin shell over that core; and the hosted p00f API only ever receives ciphertext. We chose this over a hosted server that decrypts, because that design puts the Fragment Key on infrastructure p00f operates, which is exactly the server-trust model ADR-0001 rejected.

## Considered options

- **A hosted server that decrypts.** Rejected. To decrypt, the Fragment Key must be delivered into a Worker p00f deploys, so the operator becomes able to read it. Even a sandboxed executor running on infrastructure p00f operates does not change this: the host marshals inputs into the sandbox and can read what it is handed. Moving where code runs does not move the trust boundary.
- **Per-surface crypto implementations.** Rejected. Multiple crypto code paths mean drift and a larger audit surface for the one thing that must be correct.
- **One caller-side core, many shells.** Chosen.

## Decisions

- **`@p00f/core`** is the single zero-knowledge engine: Fragment Key, clip id, and owner-token generation, the HKDF hierarchy and AES-GCM of ADR-0009, Link build and parse, and a ciphertext-only protocol client for the create, meta, reveal, and delete endpoints. It uses Web Crypto only, so it runs in browsers, Node, and workerd.
- **Shells over the core:** the web app (browser) and the `poof` CLI (Node). Neither reimplements crypto.
- **The agent handoff capability is the full Link** (path id plus Fragment Key). The owner token is never in the Link (ADR-0008), so a link-holder cannot burn the Clip.
- **The hosted API is a ciphertext-only relay.** The Fragment Key never reaches it.
- **The CLI is stateless.** No local owner-token registry; early burn pastes the owner token back (`poof burn <link> --token ...`).
- **No hosted-decrypt convenience mode.** It is deliberately not offered.

## Consequences

- Zero-knowledge holds identically across the web app and the CLI: p00f and Cloudflare are architecturally unable to read plaintext or the Fragment Key.
- The receiving agent, and the LLM behind it, necessarily see the plaintext, because reading the content is the point of a handoff. This is identical to the human who opens a Link today. Zero-knowledge is a statement about the storage operator, not the recipient.
- One crypto implementation to audit and test. The day the CLI wraps the core with no duplicated logic is the signal the core is factored correctly.
- A hosted-decrypt mode would be the only feature able to read user data, so excluding it keeps the core promise intact.
- Because the hosted API is ciphertext-only, a functional read requires a caller-side shell that holds the Fragment Key (the CLI, or any program that links the core). A raw HTTP caller can fetch the ciphertext but must implement the wire format to decrypt.
- The wire format (KDF salt and info strings, AES-GCM nonce layout, base64url variant, and the envelope schema) is published in the discovery document and `llms.txt`, so a non-SDK caller can implement decryption. `@p00f/core` is the supported reference implementation; raw-HTTP read without it means reimplementing the wire format.
