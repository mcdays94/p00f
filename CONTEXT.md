# Poof

Poof is a zero-knowledge, ephemeral clipboard-sharing tool built on the Cloudflare developer platform (Workers + Durable Objects). You paste text, code, an image, or a file in the browser; Poof encrypts it locally and hands you a short-lived link to share. The server never sees the contents.

The public brand and domain are `p00f.me` (chosen, via the Cloudflare Registrar). The repo and code identifiers stay `poof` and `clip`. The reusable zero-knowledge engine is published as `@p00f/core` on npm.

## Language

**Clip**:
The single unit a user shares: text, code, an image, or a file. Encrypted in the browser before it ever leaves the device.
_Avoid_: paste, snippet, blob, item, document.

**Link**:
The shareable URL for a Clip. Carries the Clip's id in the path and its Fragment Key in the URL fragment.
_Avoid_: share URL, paste link.

**Fragment Key**:
The symmetric decryption key for a Clip, carried in the URL fragment (`#...`). Browsers never transmit the fragment to the server, so the server cannot derive it.
_Avoid_: password, secret, token (all overloaded; the PIN is a separate concept).

**Zero-Knowledge**:
The property that the server (and therefore Cloudflare, and anyone who breaches storage) only ever holds ciphertext for a Clip. It is a confidentiality guarantee, not an access-control mechanism.
_Avoid_: using "secure" as a synonym; secure conflates confidentiality with access control.

**Reveal**:
The explicit user action (clicking "Reveal") that causes the server to release a Clip's ciphertext to the browser. The only event counted against the reveal budget.
_Avoid_: view, open, read (use Reveal for the budget-consuming action specifically).

**Burn**:
Permanent destruction of a Clip's ciphertext, triggered when its TTL expires or its reveal budget reaches zero, whichever comes first.
_Avoid_: delete, expire (Burn covers both triggers).

**Countdown**:
The recipient-facing view of a Clip's remaining time before its TTL Burn. Rendered client-side from the `expiresAt` carried in the Clip's encrypted metadata (so only a Fragment-Key holder can read the deadline), on by default and controllable by the creator. When it reaches zero on an open page the revealed content auto-clears: a best-effort UX affordance, not a confidentiality control, since an already-revealed Clip may have been copied (ADR-0014).
_Avoid_: timer, TTL bar (reserve "Countdown" for this recipient-facing remaining-time view).

**Reveal budget**:
The number of times a Clip may be revealed before it burns. Default 1. Counts Reveals (ciphertext releases), not distinct users.
_Avoid_: views, reads, "number of users".

**Kind**:
The category of a Clip's content that drives how it renders. Inferred client-side at create time and stored in the Clip's encrypted metadata, so the server never learns it. An open set of understood values rather than a fixed list: text, code, image, file, secret, and url. The web app renders each understood Kind and falls back to text-or-download for anything else.
_Avoid_: type, format, mime (reserve "Kind" for this content category).

**Masked URL**:
A Clip of Kind `url` whose decrypted content is a destination URL (http or https only). The poof Link stands in for that URL: on Reveal the recipient sees the destination and can open it. The server never sees the destination (it is encrypted content like any other Clip), so this masks a real URL behind a Link without shortening it and without weakening Zero-Knowledge. The masked target is the "destination URL"; it is distinct from the Link (the poof share URL).
_Avoid_: short link, shortener, redirect (the server never resolves the destination).

**PIN / password**:
An optional variable-length second factor for a Clip (a PIN or password, 4 to 128 characters, any characters), shared out-of-band by the sharer. Gates server-side release of the content blob and is folded into the content key. Distinct from the Fragment Key. A PIN/password Clip is browser-reveal-only, since the machine path has no Turnstile (ADR-0004/0005/0011). Was originally a 4-digit numeric PIN; widened 2026-06-21.
_Avoid_: passcode, code (use "PIN" for a short numeric secret and "password" for a longer one; they are the same factor through the same server gate + key fold).

**Owner token**:
A high-entropy secret returned to the creator once at create time, never part of the Link, that authorizes an early Burn of their own Clip. Distinct from the Fragment Key and the PIN.
_Avoid_: admin key, management password, delete key.

## Relationships

- A **Clip** is encrypted client-side; the server stores only its ciphertext.
- A **Link** references exactly one **Clip** and carries that Clip's **Fragment Key**.
- Possession of a **Link** (path id + **Fragment Key**) is the secret required to decrypt a **Clip**. Any further gating (expiry, PIN, approval) controls *release of the ciphertext*, not decryption.
- A **Clip** is destroyed by **Burn**, triggered by TTL expiry or by its **Reveal budget** reaching zero. Each **Reveal** decrements the budget.
- A **Clip** may carry an optional **PIN**. Releasing its content then requires the correct **PIN** (verified server-side) in addition to the **Fragment Key** (which decrypts). Wrong **PIN** attempts trigger lockout, never **Burn**.
- Only the holder of a Clip's **Owner token** can **Burn** it early. The token is never carried in the **Link**, so a link-holder cannot destroy the Clip.

## Example dialogue

> **Dev:** "If someone gets the Clip id but not the fragment, can they read it?"
> **Product:** "No. The id only lets the server find the ciphertext. Without the **Fragment Key** from the **Link**, it's gibberish. That's the **Zero-Knowledge** guarantee."
> **Dev:** "So an expiry or PIN doesn't protect the contents, it just controls whether we hand over the bytes?"
> **Product:** "Right. The link itself is the real secret. Gates decide *when* we release the ciphertext, not *whether* it can be decrypted."

## Flagged ambiguities

- "paste" / "clipboard" were used loosely for the shared unit. Resolved: the canonical term is **Clip**.
- "secure" was used to mean confidentiality. Resolved: we mean **Zero-Knowledge** (server holds only ciphertext). Access control (expiry/PIN/approval) is tracked separately and is not "security" in the confidentiality sense.
- "read by X users" was used for the burn limit. Resolved: with no identity to dedupe on, we count **Reveals** (ciphertext releases), not users. The canonical term is **Reveal budget** and the UI says "reveals," never "users."
- A "URL shortener" was requested but rejected: a server-resolvable short link would break Zero-Knowledge (ADR-0001, ADR-0010), and a poof Link cannot be short because it carries the Fragment Key. Resolved: the **Masked URL** Kind (`url`) masks a destination behind a Link without shortening it or resolving it server-side (ADR-0013).
- "Kind" was originally a fixed four-way set (text, code, image, file). It has since grown (secret in v2, url for masked links) and is now an open set of understood values; the term no longer implies exactly four.
- The TTL deadline was a cleartext envelope field. Resolved (ADR-0014): it moved into the Clip's encrypted metadata so only a Fragment-Key holder can read it (real privacy from the server and API scrapers). The server keeps its own authoritative expiry to run the Burn but no longer publishes it; the recipient-facing **Countdown** is rendered from the decrypted metadata.
