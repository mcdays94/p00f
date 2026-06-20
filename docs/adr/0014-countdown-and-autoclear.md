# 0014 - Visible TTL countdown, best-effort auto-clear, and private expiry

**Status:** accepted

A Clip already burns at its TTL (ADR-0002). This ADR makes that deadline *visible* to the recipient as a countdown, makes a revealed Clip *clear itself from an open page* when the deadline passes, and does both without leaking the deadline to the server or to anyone who only scrapes the API.

## Decisions

- **The expiry deadline lives in the encrypted metadata, not the cleartext envelope.** `expiresAt` is removed from the `.json` envelope, the `/api/clip/:id/meta` response, and the published wire format's cleartext field list. It is written into the encrypted metadata blob (`ClipMeta.expiresAt`) at create time, so only a Fragment-Key holder can read the deadline. This is the "real privacy" choice: the server still keeps its own authoritative `expires_at` to enforce the Burn (it must, to run the alarm), but it no longer *publishes* it. A non-key-holder can still detect that a Clip became gone by polling, but cannot read a precise ticking deadline.
- **The recipient sees a countdown, on by default, creator-controllable.** After the recipient decrypts the metadata, the client renders a countdown from `expiresAt`. The creator can turn it off via an encrypted `ClipMeta.showCountdown` flag (default on). Because the revealer holds the key, hiding the countdown from them is necessarily UI-level; the cryptographic privacy is against the server and API scrapers (achieved above). The countdown needs only the remaining time, not the original TTL: it depletes from "remaining when the page opened" to zero.
- **Best-effort auto-clear, honestly labelled.** When the countdown reaches zero on an open page, the client tears down the revealed content (removes the opaque-origin sandbox iframe and drops the decrypted bytes from its in-memory cache) and shows the gone state. This is a UX affordance, NOT a security guarantee: anyone who already revealed the Clip may have copied or screenshotted it, and auto-clear cannot un-reveal it. The honesty copy says so.
- **One non-consuming recheck closes the clock-skew gap.** The countdown runs on the client clock, which can differ from the server's. At (or just after) zero, the client does a single non-consuming `GET /api/clip/:id/meta`; a 404 confirms the server burned it and the client shows gone. If the Clip somehow still exists (client clock ran fast), the client waits a short grace and rechecks rather than clearing prematurely. The actual destruction stays server-authoritative.

## Considered options

- **Keep `expiresAt` in the cleartext envelope and only hide the bar in the UI:** rejected for this feature. It is cheaper, but the deadline stays readable from the API, so "don't reveal how long they have" would be cosmetic. The product chose real privacy.
- **Store the original `ttlMs` (total duration) in metadata for a proportional bar:** rejected as unnecessary. Remaining time alone drives the representation; the bar references "remaining when opened," so no total is needed and no extra field is stored.
- **Server-pushed countdown / polling the deadline:** rejected. Returning remaining time from the server would re-leak the deadline in cleartext, defeating the privacy decision.
- **Treating auto-clear as a confidentiality control:** rejected and called out explicitly. The plaintext was already shown to a human; ephemerality of an idle tab is the only thing auto-clear buys.

## Consequences

- The published wire format changes: `expiresAt` moves from the envelope's cleartext list into the encrypted metadata blob alongside `kind`/`filename`/`mime`/`size`. `@p00f/core` and the discovery doc / `llms.txt` are updated together so the contract cannot drift. Agents that previously read `expiresAt` without the key no longer can; they still see `revealsRemaining`, `pinRequired`, `hasContent`, and the coarse `sizeBucket`.
- `ClipMeta` gains optional `expiresAt` and `showCountdown`. Older Clips created before this change simply have no `expiresAt` in their metadata, so the client shows no countdown for them and relies on the server burn plus the existing gone-state handling.
- The countdown is a recipient-side affordance only; it adds no server state and no new endpoint (it reuses the non-consuming meta route for the skew recheck).
