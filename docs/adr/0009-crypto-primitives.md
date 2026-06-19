# 0009 - Cryptographic primitives

**Status:** accepted

Concrete primitives behind ADR-0001 (zero-knowledge) and ADR-0004 (PIN). All client-side crypto uses the Web Crypto API (`crypto.subtle`); no third-party crypto library.

## Decisions

- **Symmetric cipher:** AES-GCM, 256-bit keys. A fresh random 96-bit (12-byte) IV per encryption, prepended to the ciphertext.
- **Master key:** 256 bits of CSPRNG output, generated in the browser, encoded as base64url (no padding) in the URL fragment. This is the Fragment Key. It never reaches the server.
- **Key hierarchy (HKDF-SHA-256 from the master key):**
  - metadata-blob key = `HKDF(ikm = master, salt = clipId, info = "poof/metadata/v1")`
  - content-blob key, no PIN = `HKDF(ikm = master, salt = clipId, info = "poof/content/v1")`
  - content-blob key, with PIN = `HKDF(ikm = master, salt = clipId, info = "poof/content/v1", + PIN mixed into ikm via concat(master, utf8(PIN)))`
  - The metadata key never depends on the PIN, so the pre-reveal card renders without it (ADR-0003).
- **PIN gate hash (server-side, in the DO):** PBKDF2-SHA-256, random 16-byte salt, high iteration count (>= 200k). Stored as `{salt, iterations, hash}`. Low-entropy secret, so a deliberately slow hash. The gate is the real protection (ADR-0004); the hash being cracked still yields no plaintext (no Fragment Key on the server).
- **Owner token:** 256 bits CSPRNG, base64url. High entropy, so a single salted SHA-256 is sufficient server-side. Returned once at create, never in the Link.
- **Clip id:** 128 bits CSPRNG, base64url. Unguessable, used only to route to the DO; distinct from all keys.
- **Encoding:** base64url without padding for Fragment Key, owner token, and ids.

## Consequences

- A wrong Fragment Key or wrong PIN yields an AES-GCM authentication failure (clean decrypt error), surfaced honestly in the UI.
- HKDF salting with the clip id domain-separates keys per Clip even in the unlikely event of master-key reuse bugs.
