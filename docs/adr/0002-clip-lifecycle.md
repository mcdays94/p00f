# 0002 - Clip lifecycle: aggressive TTL, burn-after-N-reveals, reveal-gate

**Status:** accepted

Every Clip dies fast and predictably. It carries a time-to-live (default 5 minutes) and a reveal budget (default 1); it burns when either the TTL expires or the budget reaches zero, whichever comes first. Reveals are gated behind an explicit user action, never auto-fetched, to stop chat-app link unfurlers from consuming the burn before a human sees the Clip.

## Decisions

- **TTL:** options `{5 min (default), 1 hour, 1 day, 7 days max}`. No "never" option; nothing is permanent by design.
- **Burn-after-read:** ON by default.
- **Reveal budget:** options `{1 (default), 3, 10, unlimited-until-expiry}`. Each Reveal decrements the budget; at zero the Clip burns.
- **Reveal-gate:** the landing page never auto-fetches the ciphertext. It shows only metadata (type, size, expiry, reveals remaining) plus a "Reveal" button. The ciphertext is released (and the budget decremented) only on that explicit click.

## Counting semantics

- We count **Reveals** (ciphertext releases from the Durable Object), not users. With no accounts and no ephemeral IDs there is no identity to dedupe on, so "X users" is unenforceable and we will not claim it. The UI says "reveals remaining," never "users."
- The budget is decremented **atomically on release** inside the Durable Object (single-threaded execution makes this race-free). We decrement on release, not on client acknowledgement, because ack-based counting is trivially gamed by a client that never acks.
- The browser caches the decrypted Clip in memory for the session so a refresh re-renders locally without spending another Reveal. Closing and reopening the tab is an honest new Reveal and does cost budget.

## Consequences

- A Reveal only stops *future* releases. Bytes already released cannot be un-shared. This is inherent to the model and must be stated honestly in the UI.
- A flaky network mid-transfer can waste a Reveal. Accepted for v1 over the gameable alternative.
- This feature set is what makes Durable Objects the correct primitive rather than decorative: it needs an atomic check-and-decrement counter and a TTL alarm, neither of which KV provides. To be expanded in the storage/architecture ADR.
