# 0015 - Reveal-side Turnstile is opt-in and decoupled from the PIN

**Status:** accepted (amends ADR-0004, ADR-0005, ADR-0011)

p00f is meant to be a great way to hand a secret to an *agent*: instead of pasting a token or password into a chat, you paste a poof link and the agent reveals it. ADR-0005 originally required a human Turnstile challenge before every PIN submission, which meant a PIN-protected poof could only be revealed in a browser (issue #18) and tied "needs a human" to "has a PIN". This ADR separates the two: whether a reveal needs a human is now an explicit, per-clip, creator-set choice, default off.

## Decisions

- **Reveal-Turnstile is a per-clip, creator-set flag, default off.** The create form carries `requireTurnstile` (a DO column `require_turnstile`); when unset, revealing needs no human. This makes the default poof revealable by anyone who holds the link, including a headless agent, the CLI, or a raw API caller.
- **It is decoupled from the PIN.** A PIN no longer implies a Turnstile gate. A PIN poof with the flag off is revealable by an agent that has the link *and* the PIN: it sends the PIN, no token, and the server returns the ciphertext. A poof can independently require a PIN, a captcha, both, or neither.
- **`turnstileRequired` is published in the cleartext envelope.** Alongside `pinRequired`, it lets a caller decide up front whether it can complete the reveal. A `turnstileRequired: true` poof cannot be revealed on the machine path; `llms.txt` and the discovery doc say so and walk an agent through the headless reveal of a non-gated poof.
- **The gate is enforced server-side, non-consuming.** The Worker verifies whatever token was sent (against the same managed-Turnstile secret) and passes a boolean to the DO; the DO refuses with `turnstile_required` (HTTP 403) before spending any reveal budget or checking the PIN when the clip required a human and none was proven. The machine path no longer fabricates a placeholder token, so a non-gated poof reveals with no token at all.
- **Create-side Turnstile is unchanged (ADR-0005).** Creation still uses Turnstile on the browser path and the identity-free rate-limit floor on the machine path (ADR-0011). This ADR is only about the *reveal* gate.

## Considered options

- **Keep Turnstile coupled to the PIN (status quo):** rejected. It conflated "weak secret, throttle brute force" with "must be a human", and it blocked the headline use case (an agent revealing a PIN-protected secret), i.e. issue #18.
- **Always require Turnstile on reveal:** rejected. It would block every agent reveal, defeating the agent-native purpose of the product.
- **Default the captcha on, opt-out:** rejected. For this product the frictionless, agent-revealable poof is the right default; a human gate is the exception a creator opts into for a sensitive or weak-PIN secret.

## Consequences

- **Brute-force posture for a default (no-captcha) PIN poof** now rests on the DO's atomic per-clip attempt cap and lockout (ADR-0004) plus the per-colo rate-limit floor (ADR-0011), not on Turnstile. For a weak 4-digit PIN this is weaker than the old per-attempt challenge (a distributed attacker is bounded by the ~5-attempt lockout and the short TTL, not by 10^4); for a strong password the entropy makes it a non-issue. Creators who want the human gate on a weak PIN turn `requireTurnstile` on. This trade-off is deliberate and called out so it is not a silent regression.
- **Issue #18 is resolved for non-gated poofs:** the CLI and core can reveal a PIN poof with just the PIN. A `requireTurnstile` poof remains browser-only by design.
- **DO schema** gains `require_turnstile` with an additive `ALTER TABLE ... ADD COLUMN` migration (idempotent), so clips created before this change keep working and simply default to off.
- **Wire format** gains a cleartext `turnstileRequired`; `@p00f/core`, the envelope, the discovery doc, and `llms.txt` are updated together so the contract cannot drift.
- The reveal-side managed Turnstile is still the free widget (ADR-0005), so self-hostability on a free Cloudflare account is unaffected.
