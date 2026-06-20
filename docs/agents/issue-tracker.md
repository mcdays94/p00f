# Issue tracker: GitHub Issues

Issues for this repo are tracked on **GitHub Issues** at `mcdays94/p00f` (private), using the `gh` CLI (authenticated as `mcdays94`).

## Source of truth

GitHub Issues on `mcdays94/p00f`. The PRDs stay canonical as markdown in `docs/prd/`; link the relevant PRD from an issue when useful.

## When a skill says "publish to the issue tracker"

Create a GitHub issue:

```sh
gh issue create -R mcdays94/p00f --title "<title>" --body "<what and why + acceptance criteria>" --label "<labels>"
```

Put acceptance criteria as a checklist in the body. Apply a state label (see `triage-labels.md`) and, where it fits, `bug` or `enhancement`.

## When a skill says "fetch the relevant ticket"

```sh
gh issue view <number> -R mcdays94/p00f
```

## Updating progress

- Move state by swapping labels: `gh issue edit <n> -R mcdays94/p00f --add-label in-progress --remove-label ready-for-agent`
- Comment with context: `gh issue comment <n> -R mcdays94/p00f --body "..."`
- "Done" is a closed issue: `gh issue close <n> -R mcdays94/p00f` (optionally `--comment "..."`). Do not keep a `done` label.

## PRDs

Canonical markdown in `docs/prd/` (`0001-poof.md` = v1, `0002-poof-agent-native.md` = v2). Reference the PRD from the issues that implement it.

## Historical ledger

`poof-issues.html` at the repo root is the historical record of the v1/v2 build (POOF-1..19, all done). It is kept for history and is no longer updated; all new issues go to GitHub.
