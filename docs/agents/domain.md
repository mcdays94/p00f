# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the glossary).
- **`docs/adr/`** — read the ADRs that touch the area you are about to work in.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/        (0001..0008, plus crypto ADR added at build start)
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (issue title, test name, hypothesis), use the term as defined in `CONTEXT.md` (`Clip`, `Link`, `Fragment Key`, `Reveal`, `Burn`, `Reveal budget`, `Kind`, `PIN`, `Owner token`, `Zero-Knowledge`). Do not drift to the synonyms the glossary lists under `_Avoid_`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
