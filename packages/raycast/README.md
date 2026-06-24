# p00f Raycast extension

Local Raycast extension for creating zero-knowledge, ephemeral Poof links from Raycast.

This package is Milestone 1 from `docs/prd/0003-p00f-raycast-extension.md`: a local developer extension that lives in this repo. Raycast Store submission is Milestone 2 and requires a separate explicit release step.

## Commands

- **Create Poof**: full form for text or one file, TTL, Reveal budget, PIN, secret mode, masked URL mode, reveal-anchored TTL, viewer-delete, reveal captcha, and countdown.
- **Poof Selection**: quick no-view command that turns selected text or one Finder-selected file into a Poof using preference defaults.
- **Poof Clipboard**: quick no-view command that turns one clipboard file, text, or HTML-as-text fallback into a Poof using preference defaults.

## Trust model

- The extension imports `@p00f/core` directly. Encryption happens locally in Raycast.
- The hosted p00f service receives only ciphertext, ids, and policy fields. The Fragment Key stays in the Link fragment.
- The extension sends no Raycast-identifying or client-identifying headers. It is just another anonymous machine-path client.
- Creates run under the same anonymous create floor as the CLI. If p00f returns `429`, the extension reports rate limiting and leaves the clipboard untouched.
- Links and owner tokens are copied with Raycast's concealed clipboard option.
- Owner tokens are not persisted by default. The full Create Poof result screen exposes the owner token once through a copy action.

## Local development

From the repo root:

```sh
npm install --prefix packages/raycast
npm run dev --prefix packages/raycast
```

The dev script builds `packages/core` first, then starts Raycast development mode.

## Verification

From the repo root:

```sh
npm run build --prefix packages/raycast
npm run lint --prefix packages/raycast
npx vitest run --reporter=verbose
```

`ray lint` currently reports one non-blocking title-case warning because the public brand is `p00f` and Raycast prefers `P00f`. ESLint is not installed in this package, so Raycast skips ESLint and still runs Prettier.

## Manual Raycast smoke checklist

- Run the extension in Raycast development mode.
- Confirm **Poof Selection** creates a Link from selected text in a real frontmost app.
- Confirm **Poof Selection** creates a Link from one Finder-selected image file.
- Confirm **Poof Clipboard** creates a Link from clipboard text.
- Confirm **Poof Clipboard** creates a Link from one copied file-like clipboard payload.
- Confirm **Create Poof** creates a Link from form text.
- Confirm the Create Poof result actions copy the Link, paste the Link, copy the owner token, burn now, and open in browser.

## Store submission

Do not publish from this package as part of Milestone 1. Store submission should be a separate Milestone 2 task that normalizes the local `file:../core` dependency to a published `@p00f/core` semver version, refreshes Store metadata, and prepares screenshots/assets for the Raycast Store workflow.
