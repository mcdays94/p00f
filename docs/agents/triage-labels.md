# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the `status` strings used in this repo's HTML issue board (`poof-issues.html`).

| Canonical role    | Status in our board | Meaning                                  |
| ----------------- | ------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`      | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-triage`      | Waiting on more information              |
| `ready-for-agent` | `ready-for-agent`   | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `blocked`           | Requires a human (records why in `body`) |
| `wontfix`         | `wontfix`           | Will not be actioned                     |

Build-flow statuses beyond the canonical roles: `in-progress` (actively being built) and `done` (acceptance criteria pass).
