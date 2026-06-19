# Issue tracker: Local human-readable HTML board

Issues and the PRD for this repo are tracked locally, with no remote, until the user decides to sync to a git remote.

## Source of truth

`poof-issues.html` at the repo root is the human-readable source of truth for all issues. It is a single self-contained file (open it directly in a browser via `file://`, no build step, no server) styled with the Cohere DESIGN.md tokens (`docs/design/cohere.DESIGN.md`).

Issue data is embedded in the file as JSON and rendered by an inline script:

```html
<script type="application/json" id="poof-issues">
[ { ...issue... }, ... ]
</script>
```

### Issue object schema

- `id` — string, e.g. `"POOF-1"`
- `title` — string
- `slice` — string, the vertical slice / area it belongs to
- `status` — one of `needs-triage` | `ready-for-agent` | `in-progress` | `done` | `blocked` | `wontfix`
- `priority` — `high` | `medium` | `low`
- `depends_on` — array of issue ids
- `body` — string, what and why
- `acceptance` — array of strings, acceptance criteria

## When a skill says "publish to the issue tracker"

Append a new issue object to the JSON array inside `poof-issues.html`. Do not hand-edit the rendered DOM; edit only the JSON block. The board re-renders from the JSON on load.

## When a skill says "fetch the relevant ticket"

Read the issue object with the given `id` from the JSON array in `poof-issues.html`.

## PRD

The PRD is canonical as markdown at `docs/prd/0001-poof.md`. Its summary and a link are surfaced at the top of `poof-issues.html`.

## Migration

When the user syncs to a remote (GitHub or GitLab), this board can be migrated to that tracker. Until then, everything stays local.
