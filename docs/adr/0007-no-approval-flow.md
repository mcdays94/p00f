# 0007 - No approval flow; access control is the PIN

**Status:** accepted (records a rejected feature)

Poof will not build an approval-to-open flow (recipient requests access, sharer approves). It conflicts with the minimalist, identity-detached design: email-based approval reintroduces server-side PII (the sharer's address) that anonymity otherwise eliminates, requires an external email provider (with SPF/DKIM/DMARC and deliverability burden) that breaks free self-hosting, and its async UX is off-brand for a tool whose default Clip lives 5 minutes. The optional PIN (ADR-0004) already serves the "sharer controls who opens it" intent at none of that cost.

## Considered options

- **Email approval:** rejected (reintroduces PII, needs an email provider, clunky async UX).
- **Live in-tab approval over a WebSocket** (sharer keeps the create tab open, approves in real time; no email, no PII): not planned, but recorded as the only shape that would be consistent with the philosophy should this ever be revisited.

## Consequences

- v1 access control is the Fragment Key (the Link) plus an optional PIN. Nothing else gates a Reveal.
- Poof holds no server-side PII anywhere.
