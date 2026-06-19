# 0005 - Abuse control: mandatory free Turnstile, no ephemeral IDs

**Status:** accepted

Poof relies on Cloudflare Turnstile (the free/managed widget) for abuse control, deliberately avoiding Enterprise-only features so anyone can self-host on a free Cloudflare account. Turnstile is mandatory on Clip creation and before each PIN attempt; ephemeral IDs are deliberately excluded from the default build.

## Decisions

- **Turnstile (free managed widget) is mandatory on every deployment.** No deploy-time opt-out.
- **Enforcement points:** (1) Clip create, always (anti-spam); (2) before each PIN submission on PIN-protected Clips (anti-brute-force). Revealing a non-PIN Clip needs no Turnstile, keeping the common path frictionless.
- **Ephemeral IDs are deliberately NOT used.** They require Enterprise Bot Management / Enterprise Turnstile, are not guaranteed unique, and would break self-hostability on free accounts. A deployer with Enterprise access can add them later as a progressive enhancement; the default build does not depend on them.
- **Belt-and-suspenders IP-based create throttling** is enforced server-side, independent of Turnstile.

## Considered options

- **Ephemeral-ID-keyed abuse detection:** rejected for the default build (Enterprise-gated, non-unique, breaks free self-hosting). Documented as an optional enhancement only.

## Consequences

- Abuse control is defence-in-depth, never the security boundary. The Fragment Key remains the boundary.
- Poof stays self-hostable on a free Cloudflare account, consistent with the open-source positioning.
