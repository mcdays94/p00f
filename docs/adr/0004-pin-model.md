# 0004 - PIN: optional server-gated second factor with lockout

**Status:** accepted

A Clip may carry an optional 4-digit PIN, shared out-of-band, as a second factor on top of the Link. Because 4 digits is only 10,000 guesses, the PIN is enforced as a server-side release gate (not pure key derivation, which would be brute-forceable offline once ciphertext is released) and is additionally folded into the content key for defence-in-depth.

## Decisions

- **Optional, off by default.** 4-digit numeric, shared out-of-band by the sharer.
- **Server-side release gate.** The Clip's Durable Object stores a salted, slow hash of the PIN and verifies a submitted PIN before releasing the content blob. The single-threaded DO makes the attempt counter race-free.
- **Defence-in-depth key binding.** content-blob key = `derive(Fragment Key + PIN)`; metadata-blob key = `derive(Fragment Key only)`. The pre-reveal card renders without the PIN, but the content cannot be decrypted without it even if storage is breached and the link leaks.
- **Failed-attempt policy: progressive lockout / cooldown (option A), not burn.** After ~5 attempts cooldown escalates; the TTL ends the Clip.
- **Turnstile gates each PIN submission** (see ADR-0005).

## Considered options

- **Pure key-derivation PIN (no server check):** rejected. A 4-digit PIN folded only into the key is brute-forced offline in milliseconds once any link-holder pulls the ciphertext.
- **Burn on too many wrong attempts:** rejected. A link-holder without the PIN otherwise cannot Reveal at all, so the PIN protects the reveal budget from a leaked link; burning on wrong PIN would hand that person a way to destroy the Clip, re-arming the griefing the PIN prevents.

## Consequences

- The server can in principle brute-force the 4-digit PIN from its stored hash, but this yields nothing: decryption still requires the Fragment Key, which the server never holds. The PIN is access control, not confidentiality.
- A link-holder without the PIN can trigger cooldowns to *delay* (not destroy or read) a Clip. Accepted, bounded by the short TTL.
- Online wrong-PIN attempts are bounded by both DO lockout and a per-attempt Turnstile challenge.
