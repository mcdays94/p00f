# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the GitHub labels used on `mcdays94/p00f`.

## Category

| Canonical role | GitHub label  |
| -------------- | ------------- |
| `bug`          | `bug`         |
| `enhancement`  | `enhancement` |

## State

| Canonical role    | GitHub label      | Meaning                                       |
| ----------------- | ----------------- | --------------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate this issue       |
| `needs-info`      | `needs-info`      | Waiting on more information                   |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent       |
| `ready-for-human` | `ready-for-human` | Requires a human (records why in the body)    |
| `wontfix`         | `wontfix`         | Will not be actioned (close the issue)        |

Build-flow labels beyond the canonical roles: `in-progress` (actively being built) and `blocked` (waiting on a dependency or decision). **Done** is not a label: a finished issue is closed.

The `bug`, `enhancement`, and `wontfix` labels are GitHub defaults; the rest were created on the repo. Create any missing label with `gh label create "<name>" -R mcdays94/p00f --color <hex> --description "<desc>"`.
