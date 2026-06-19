# 0001 - Zero-knowledge trust model (key in URL fragment)

**Status:** accepted

Poof encrypts every Clip in the browser (AES-GCM) before upload and carries the decryption key in the URL fragment (`#...`), which browsers never send to the server. The Durable Object stores only ciphertext, so the server, Cloudflare, and anyone who breaches storage cannot read a Clip. We chose this over the simpler server-trust model because the product's positioning ("honest about risk, genuinely private") is incompatible with a server that can read user contents.

## Considered options

- **Server-trust:** DO stores plaintext and gates access with PIN/approval. Simplest, lets the server inspect content and detect type server-side, but cannot offer any real confidentiality.
- **Hybrid:** plaintext by default, optional client-side encryption toggle. Rejected: a confidentiality story that is off by default is a confidentiality story nobody trusts, and it doubles the code paths.
- **Zero-knowledge, key in fragment (chosen).**

## Consequences

- The **Link** (path id + Fragment Key) is the true secret. Anyone with the full link can decrypt.
- Expiry, PIN, and the approval flow gate *release of the ciphertext*, not decryption. They are access control layered on top of confidentiality, not the source of confidentiality.
- The server cannot detect content type, render previews, or generate thumbnails. Type detection and rendering (code highlighting, image preview) happen client-side after decryption. Content type and other metadata live in a dedicated encrypted metadata blob, separate from the encrypted content blob (see ADR-0003); the server only ever holds ciphertext for both.
- A lost Fragment Key means the Clip is permanently unrecoverable. This is a feature, not a bug, but must be surfaced honestly in the UI.
- The 4-digit PIN must be designed against this model (server-side release gate vs. folded into key derivation). Tracked as a downstream decision.
