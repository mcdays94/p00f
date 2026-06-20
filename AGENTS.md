# Poof

Zero-knowledge, ephemeral clipboard sharing on Cloudflare Workers + Durable Objects. Paste text, code, an image, or a file; get a short-lived link; the server only ever holds ciphertext. See `CONTEXT.md` for the domain glossary and `docs/adr/` for the decisions behind the design.

## Project status

Deployed and live at `https://p00f.me` on the `mdias.info` Cloudflare account (account_id `9993650612175c36066a397a94466033`). Code is at `github.com/mcdays94/p00f` (PRIVATE). The zero-knowledge engine is published as `@p00f/core` on npm. Personal identity throughout (`amtccdias@gmail.com` / `mcdays94`). CI/CD is not wired yet, so deploys are manual. Standing rule: never push to the remote or deploy (`wrangler deploy`, `wrangler secret put`) without an explicit ask.

## Agent skills

### Issue tracker

Issues are tracked on **GitHub Issues** (`mcdays94/p00f`, private) via the `gh` CLI. See `docs/agents/issue-tracker.md`. The local `poof-issues.html` is the historical v1/v2 build ledger (POOF-1..19, all done) and is no longer updated.

### Triage labels

The canonical triage roles map to GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Issues system operating manual

Issues live on **GitHub Issues** at `mcdays94/p00f` (private). Use the `gh` CLI (authenticated as `mcdays94`).

### Common operations

- **List:** `gh issue list -R mcdays94/p00f`
- **View / fetch a ticket:** `gh issue view <n> -R mcdays94/p00f`
- **Create (publish to the tracker):** `gh issue create -R mcdays94/p00f --title "..." --body "..." --label "<labels>"`
- **Update progress:** `gh issue edit <n> -R mcdays94/p00f --add-label in-progress --remove-label ready-for-agent`; comment with `gh issue comment <n> ...`; finish with `gh issue close <n>`.

### Labels (state)

`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `in-progress`, `blocked`, plus the GitHub defaults `bug`, `enhancement`, `wontfix`. "Done" is a closed issue (no label). Full mapping in `docs/agents/triage-labels.md`.

### PRDs

PRDs stay canonical as markdown in `docs/prd/` (`0001-poof.md`, `0002-poof-agent-native.md`). Link the PRD from the relevant GitHub issue.

### Historical ledger

`poof-issues.html` records the v1/v2 build (POOF-1..19, all done). Keep it for history; do not add new issues there.

## Build & dev (local only)

- First-time setup: `cp .dev.vars.example .dev.vars` (provides the public Turnstile test secret to `wrangler dev` and the test pool). `.dev.vars` is gitignored; production sets a real `TURNSTILE_SECRET` via `wrangler secret put`.
- Dev server via portless: `portless run npx wrangler dev --port $PORT`, referenced as `https://poof.localhost`. Never deploy without an explicit ask.
- Tests: `npx vitest run` (Worker and Durable Object tests run under `@cloudflare/vitest-pool-workers`).
- Git: remote is `github.com/mcdays94/p00f` (private), personal identity (`amtccdias@gmail.com` / `mcdays94`). Small, focused commits. Never push or deploy without an explicit ask.

## Writing style

No em-dashes in any user-facing content, docs, seed/sample data, UI strings, or commit messages (house rule). Use periods, commas, parentheses, or restructure the sentence.
