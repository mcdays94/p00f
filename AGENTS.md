# Poof

Zero-knowledge, ephemeral clipboard sharing on Cloudflare Workers + Durable Objects. Paste text, code, an image, or a file; get a short-lived link; the server only ever holds ciphertext. See `CONTEXT.md` for the domain glossary and `docs/adr/` for the decisions behind the design.

## Project status

Local-first. No git remote yet. Everything stays local until the user explicitly syncs. Never push to a remote and never deploy (`wrangler deploy`) without an explicit ask. Local dev only (`wrangler dev`).

## Agent skills

### Issue tracker

Issues and the PRD are tracked locally in a single human-readable HTML board, `poof-issues.html` (repo root). See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage roles map to board `status` strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Issues system operating manual

`poof-issues.html` is the human-readable source of truth for all issues. It is a single self-contained file: open it directly in a browser (`file://`), no build step, no server. It is styled with the Cohere DESIGN.md tokens and renders its board from an embedded JSON array via an inline script.

### Data model

Inside `poof-issues.html`:

```html
<script type="application/json" id="poof-issues">
[ { "id": "POOF-1", "title": "...", "slice": "...", "status": "...", "priority": "...", "depends_on": [], "body": "...", "acceptance": ["..."] } ]
</script>
```

Status vocabulary: `needs-triage` | `ready-for-agent` | `in-progress` | `done` | `blocked` | `wontfix`.

### How to update the HTML source of truth

- **Add an issue:** append a new object to the JSON array in the `#poof-issues` script block.
- **Update progress:** edit that issue's `status` (flip to `in-progress` when you start it, `done` when its acceptance criteria pass). Add a short note to `body` if useful.
- Edit **only the JSON block**, never the rendered DOM. The inline script rebuilds the board from the JSON on load.
- Keep the PRD (`docs/prd/0001-poof.md`) as the canonical spec; the board surfaces its summary and a link at the top.
- Everything stays local until the user syncs to a remote.

## Build & dev (local only)

- First-time setup: `cp .dev.vars.example .dev.vars` (provides the public Turnstile test secret to `wrangler dev` and the test pool). `.dev.vars` is gitignored; production sets a real `TURNSTILE_SECRET` via `wrangler secret put`.
- Dev server via portless: `portless run npx wrangler dev --port $PORT`, referenced as `https://poof.localhost`. Never deploy without an explicit ask.
- Tests: `npx vitest run` (Worker and Durable Object tests run under `@cloudflare/vitest-pool-workers`).
- Git: local-first, personal identity (`amtccdias@gmail.com` / `mcdays94`). Small, focused commits. Never push without an explicit ask.

## Writing style

No em-dashes in any user-facing content, docs, seed/sample data, UI strings, or commit messages (house rule). Use periods, commas, parentheses, or restructure the sentence.
