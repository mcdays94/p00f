# 0011 - Abuse control on the machine path (no Turnstile for non-browser callers)

**Status:** accepted (extends ADR-0005)

ADR-0005 makes Turnstile mandatory, but Turnstile assumes a human clicking a managed widget. The CLI, the MCP server, Code Mode agents, CI jobs, and raw API callers have neither a human nor a browser, so they cannot solve it. This ADR defines abuse control for the machine path without a human, without reintroducing PII (ADR-0007), and without breaking free self-hosting (ADR-0005). The model is one identity-free rate-limit floor for everyone, raised by either a human proof (Turnstile, on the browser path) or, later, a machine proof (an optional PII-free bearer key). Anonymous machine creation stays possible at the floor.

## Decisions

- **A shared floor, enforced in Worker logic** via the GA Workers `ratelimit` binding (`/workers/runtime-apis/bindings/rate-limit/`). It ships in `wrangler.jsonc` plus code, so a self-hoster gets identical protection on `wrangler deploy` with no dashboard steps. The floor applies to create and reveal, keyed by IP. PIN brute force is deliberately not defended by this per-colo floor (a distributed attacker spreads guesses across data centers); it is defended by the per-clip, atomic, colo-independent attempt cap and lockout inside ClipDO (ADR-0004), and a wrong PIN never consumes reveal budget.
- **The browser path keeps Turnstile** (ADR-0005) on create; on reveal it is required only when the creator opted into a reveal captcha (ADR-0015), no longer implied by a PIN. Clearing the create challenge raises the caller above the floor. A non-gated poof (the default) is therefore revealable on the machine path with no token, with just the PIN if one is set, which is what lets an agent reveal a PIN-protected secret (resolves #18).
- **The machine path serves no Turnstile widget.** The JSON API has no widget to solve, so machine callers sit at the floor. Anonymous machine create is allowed at the floor (Option 1).
- **Optional PII-free bearer key: designed-for, not built in v1** (free for now). When added, a key is a capability token, not an account, obtainable without identity, that raises limits. A future paid key (unlimited) is a monetization layer whose billing identity is decoupled from Clip storage.
- **A self-declared header (for example `agent: true`) may never change entitlement.** It may only influence which representation is served (content negotiation). Any header that proves something is an API key; any header that proves nothing is decoration.
- **WAF rate-limiting rules are optional outer hardening for the hosted instance only**, never a dependency of the OSS core. Cloudflare's always-on network DDoS protection sits underneath for free.

## Considered options

- **Self-declared "I am an agent" header to skip Turnstile.** Rejected. It trusts client input, a single `curl -H` bypasses it, and it proves nothing; making it provable just reinvents the bearer key.
- **Require a key for all machine create.** Rejected for v1. It breaks the instant, anonymous onboarding that is the entire agent value, and free keys are farmable, so the friction buys little. Reserved as an escalation if abuse demands it, alongside proof-of-work on the keyless floor.
- **Globally exact rate limit via a central DO or D1 counter.** Rejected for the floor. It is heavier than a floor needs; the DO's atomic per-clip reveal-budget is the real correctness boundary.

## Consequences

- `poof file.txt` works with no signup, throttled at the floor.
- The `ratelimit` binding is enforced per data center, so the floor is approximate globally. Acceptable: the DO atomic reveal-budget is the correctness boundary, and network DDoS absorbs volumetric floods.
- No PII on the default or free-key paths, so ADR-0007 holds.
- Self-hostable on free: the floor is in the repo; the WAF layer is optional.
- Proof-of-work on the keyless floor is a designed-for escalation if IP throttling proves insufficient, kept out of v1 to protect latency and simplicity.
