# Poof

Poof is a zero-knowledge, ephemeral clipboard-sharing tool built on the Cloudflare developer platform (Workers + Durable Objects). You paste text, code, an image, or a file in the browser; Poof encrypts it locally and hands you a short-lived link to share. The server never sees the contents.

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

**Reveal budget**:
The number of times a Clip may be revealed before it burns. Default 1. Counts Reveals (ciphertext releases), not distinct users.
_Avoid_: views, reads, "number of users".

## Relationships

- A **Clip** is encrypted client-side; the server stores only its ciphertext.
- A **Link** references exactly one **Clip** and carries that Clip's **Fragment Key**.
- Possession of a **Link** (path id + **Fragment Key**) is the secret required to decrypt a **Clip**. Any further gating (expiry, PIN, approval) controls *release of the ciphertext*, not decryption.
- A **Clip** is destroyed by **Burn**, triggered by TTL expiry or by its **Reveal budget** reaching zero. Each **Reveal** decrements the budget.

## Example dialogue

> **Dev:** "If someone gets the Clip id but not the fragment, can they read it?"
> **Product:** "No. The id only lets the server find the ciphertext. Without the **Fragment Key** from the **Link**, it's gibberish. That's the **Zero-Knowledge** guarantee."
> **Dev:** "So an expiry or PIN doesn't protect the contents, it just controls whether we hand over the bytes?"
> **Product:** "Right. The link itself is the real secret. Gates decide *when* we release the ciphertext, not *whether* it can be decrypted."

## Flagged ambiguities

- "paste" / "clipboard" were used loosely for the shared unit. Resolved: the canonical term is **Clip**.
- "secure" was used to mean confidentiality. Resolved: we mean **Zero-Knowledge** (server holds only ciphertext). Access control (expiry/PIN/approval) is tracked separately and is not "security" in the confidentiality sense.
- "read by X users" was used for the burn limit. Resolved: with no identity to dedupe on, we count **Reveals** (ciphertext releases), not users. The canonical term is **Reveal budget** and the UI says "reveals," never "users."
