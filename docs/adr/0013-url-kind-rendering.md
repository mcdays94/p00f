# 0013 - URL (masked link) Kind: parent-rendered with an http/https allowlist

**Status:** accepted

v2 adds a `url` Kind: a Clip whose decrypted content is a destination URL, shared so that a poof Link masks a real URL (for example a local-network `http://192.168.1.42:8080`, or a dev URL). To be useful the recipient must be able to open the destination in a new tab, which means rendering it as a clickable anchor. But ADR-0012 isolates all revealed content in an opaque-origin sandbox precisely because revealed content is attacker-controlled and the parent document holds the Fragment Key. A clickable link is the one case that cannot live in that sandbox (a sandboxed frame with no `allow-same-origin` and no `allow-popups` cannot open a new tab), so it must render in the key-holding parent. That reintroduces a script-execution vector (a `javascript:` or `data:` href would run in the key-holding origin and could exfiltrate the Fragment Key), which we close with a strict scheme allowlist.

## Considered options

- **Render the url Kind inside the sandbox like every other Kind (ADR-0012).** Rejected: the sandbox has an opaque origin and no `allow-popups` or `allow-top-navigation`, so a link inside it cannot send the recipient to the destination. The feature would not work.
- **Auto-redirect the top frame on Reveal.** Rejected as the default: it sends the recipient to an unseen URL, and it still must validate the scheme (a `javascript:` URL would execute in the key-holding origin first). Showing the URL before opening is safer and preserves the explicit-Reveal honesty model (ADR-0003).
- **Parent-rendered anchor with a scheme allowlist (chosen).**

## Decisions

- **The url Kind renders in the key-holding parent document, not the sandbox.** This is a deliberate, narrow exception to ADR-0012, justified by the need to open a destination in a new tab.
- **http and https only.** The destination is validated with `new URL()` and a `protocol` check before it is ever used as an href or for navigation. Any other scheme (`javascript:`, `data:`, `vbscript:`, `file:`, and so on) is rejected, and such content falls back to escaped text in the sandbox. This is the load-bearing control that stops a malicious url Clip from running script in the key-holding origin.
- **Shown as text and as a button, both anchors.** The URL is displayed as text that is itself a clickable anchor, plus an explicit "open link" button. Both use `target="_blank"` and `rel="noopener noreferrer"`. The URL string is set via `textContent` (never as HTML); only a validated href is ever assigned.
- **No silent auto-redirect.** On Reveal the recipient sees the destination before opening it. Reveal stays explicit and budget-consuming (ADR-0002, ADR-0003).

## Consequences

- A url Clip masks a real URL behind a Link (a clean p00f.me Link instead of a raw IP and port) while Zero-Knowledge holds: the server never sees the destination, which is encrypted content.
- It does not shorten the Link (the Link still carries the Fragment Key). This is masking, not shortening.
- The scheme allowlist is security-critical. Weakening it (allowing other schemes, or assigning an href before validation) reintroduces the key-exfiltration path ADR-0012 closes. Tests must assert that non-http(s) schemes never become clickable.
- "X visits" is best-effort: once revealed, the recipient holds the raw destination and can revisit it directly, so the Reveal budget limits resolutions of the poof, not hits on the destination.
- The future CLI and agent "instant ephemeral share" (auto-provision a Cloudflare Tunnel for a local dev server and wrap its URL in a url Clip) builds on this Kind. It is out of scope here and tracked separately.
