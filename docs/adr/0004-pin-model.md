# 0004 - PIN: optional server-gated second factor with lockout

**Status:** accepted

**Amended 2026-06-21:** the second factor is now a variable-length PIN *or* password (4 to 128 characters, any characters), not strictly 4 numeric digits. The dual model below (server-side release gate + content-key fold + lockout) is unchanged; only the accepted shape of the secret widened. The crypto (`master || secret` IKM) and the Durable Object's PBKDF2 hash were already length-agnostic, so the change is validation and UI only.

A Clip may carry an optional PIN or password, shared out-of-band, as a second factor on top of the Link. Because the secret may be weak (a short numeric PIN is only a few thousand guesses), it is enforced as a server-side release gate (not pure key derivation, which would be brute-forceable offline once ciphertext is released) and is additionally folded into the content key for defence-in-depth. A longer password simply carries more entropy through the same machinery.

## Decisions

- **Optional, off by default.** A variable-length secret (PIN or password, 4 to 128 characters, any characters), shared out-of-band by the sharer. A 4-digit numeric PIN is the weak end of the range; a passphrase is the strong end. The single shared validator (`src/shared/pin.ts`) keeps the client and the Worker from drifting on the bound.
- **Server-side release gate.** The Clip's Durable Object stores a salted, slow hash (PBKDF2) of the secret and verifies a submitted secret before releasing the content blob. The single-threaded DO makes the attempt counter race-free.
- **Defence-in-depth key binding.** content-blob key = `derive(Fragment Key + secret)`; metadata-blob key = `derive(Fragment Key only)`. The pre-reveal card renders without the secret, but the content cannot be decrypted without it even if storage is breached and the link leaks.
- **Failed-attempt policy: progressive lockout / cooldown (option A), not burn.** After ~5 attempts cooldown escalates; the TTL ends the Clip.
- **Turnstile gates each secret submission** (see ADR-0005). This originally made a PIN/password Clip browser-reveal-only, because the machine path (the CLI) has no Turnstile (ADR-0011). ADR-0015 later decoupled the reveal captcha from the PIN, so a default PIN poof is now revealable from the CLI with just the PIN.

## Considered options

- **Pure key-derivation PIN (no server check):** rejected. A weak secret folded only into the key is brute-forced offline in milliseconds once any link-holder pulls the ciphertext. The server gate is what makes a weak secret usable, so it stays regardless of length.
- **Burn on too many wrong attempts:** rejected. A link-holder without the secret otherwise cannot Reveal at all, so the secret protects the reveal budget from a leaked link; burning on a wrong attempt would hand that person a way to destroy the Clip, re-arming the griefing the secret prevents.
- **Forcing a minimum password strength / character classes:** rejected as unnecessary friction. The server gate plus lockout bounds online guessing for even a weak secret, and the Fragment Key (not the secret) is what keeps content confidential.

## Consequences

- The server can in principle brute-force a weak secret from its stored hash, but this yields nothing: decryption still requires the Fragment Key, which the server never holds. The PIN/password is access control, not confidentiality.
- A link-holder without the secret can trigger cooldowns to *delay* (not destroy or read) a Clip. Accepted, bounded by the short TTL.
- Online wrong-secret attempts are bounded by both DO lockout and a per-attempt Turnstile challenge.
