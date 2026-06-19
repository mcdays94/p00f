# 0008 - Owner token for early burn (hidden advanced affordance)

**Status:** accepted

The creator receives a high-entropy owner token at create time, distinct from the Link and never carried in it, which authorizes an early Burn ("delete now"). It is surfaced as a hidden/advanced affordance so the primary UI stays minimal.

## Decisions

- On create, the DO stores a hash of a high-entropy owner token; the token is returned once to the creator.
- The token is **never** part of the shareable Link, so a link-holder cannot use it to destroy the Clip (consistent with ADR-0004's rejection of burn-on-wrong-PIN: holding the link must not grant destruction).
- Surfaced as a hidden/advanced affordance on the create-success screen (for example behind an "Advanced" disclosure): an immediate "Delete now" action, and optionally a one-time management link the creator can keep to burn the Clip later from another device.
- v1 scope is "burn now" only. No edit, no TTL extension, no dashboard.

## Consequences

- Early burn works without accounts or identity, purely secret-based, consistent with the anonymous model.
- If the creator loses the token and closes the tab, they cannot early-burn; the Clip still dies at TTL or reveal budget. Accepted.
