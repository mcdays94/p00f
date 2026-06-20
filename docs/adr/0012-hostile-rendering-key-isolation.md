# 0012 - Revealed content is rendered as hostile (Fragment Key isolation)

**Status:** accepted

Revealed Clip content is attacker-controlled and is decrypted on the p00f origin, which is also the origin whose `location.hash` holds the Fragment Key. Any script execution on that origin (an HTML Clip, an inline SVG, an unescaped code or text view, a crafted file preview) can read the fragment and exfiltrate the key, which is a total break of zero-knowledge (ADR-0001). v2 widens this surface by adding image, file, a `secret` kind, and a text-or-download fallback for unknown kinds. Therefore all revealed content is rendered as hostile: isolated from the document that holds the key.

## Decisions

- **Sandboxed render.** Revealed content is rendered inside a sandboxed iframe with no `allow-same-origin` (a unique opaque origin), so content scripts cannot reach the parent document's `location.hash`, cookies, or storage.
- **The key never enters the sandbox.** Decryption happens in the key-holding document; only the resulting plaintext bytes are passed into the sandbox (for example via `postMessage` or a blob URL). The Fragment Key is never passed in.
- **Strict CSP.** The key-holding document allows no inline script execution. The sandbox runs with a minimal policy (`default-src 'none'` plus only what a Kind needs, for example `img-src data:` for images).
- **SVG and unknown kinds are downloads,** forced as `application/octet-stream` with the `download` attribute, never rendered inline (SVG can carry script).
- **text and code are escaped** and rendered as text, never as HTML; highlighting operates on already-escaped tokens.

## Considered options

- **Render decrypted content directly in the main document.** Rejected. One XSS (an HTML or SVG Clip) reads `location.hash` and exfiltrates the key. The prize is the key itself, not a session, so this is fatal.
- **Sanitize HTML instead of sandboxing.** Rejected. Sanitizers are a moving target and a single bypass is total, because the prize is the key.

## Consequences

- An XSS payload inside a Clip executes, at worst, in an opaque-origin sandbox with no key, no parent access, and no network, so it cannot exfiltrate the Fragment Key.
- Rich rendering is constrained (no inline SVG, no arbitrary HTML execution), accepted as the cost of protecting the key.
- This burden falls on the web app. The CLI and MCP shells return bytes to the caller rather than rendering, so they avoid the key-exfil risk entirely; their only related duty is to not write raw binary to a TTY (a usability concern, not a key concern).
