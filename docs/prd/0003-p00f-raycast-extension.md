# PRD 0003 - p00f Raycast extension

## Problem Statement

p00f already works well in the browser and from the `poof` CLI. A macOS user who lives in Raycast still has to leave Raycast, open a terminal, or visit the web UI to turn selected text, clipboard contents, or a file into a Poof. That adds friction to the fastest desktop sharing flow: capture something from the current app, create a zero-knowledge Poof, and paste the link into the conversation already in front of the user.

The Raycast extension should become another thin caller-side shell over `@p00f/core`, following ADR-0010. Encryption must happen locally in the extension, the Fragment Key must stay client-side in the Link fragment, and the hosted p00f service must remain ciphertext-only and as oblivious as possible. The server should not learn that the caller is Raycast.

## Solution

Build a local-first Raycast extension under `packages/raycast/` with three commands:

1. **Poof Selection**: a no-view quick command that reads selected text from the frontmost app, creates a Poof with preference defaults, copies the Link to the clipboard using Raycast's concealed copy option, and optionally pastes it back into the frontmost app.
2. **Poof Clipboard**: a no-view quick command that reads the clipboard, creates a Poof from one file-like item or text, copies the Link concealed, and optionally pastes it.
3. **Create Poof...**: a view command with a Raycast Form for text or one file, TTL, Reveal budget, PIN, secret-kind masking, masked URL mode, reveal-anchored TTL, viewer-delete, reveal Turnstile requirement, and countdown preference. On success it shows a Detail screen with actions to copy the Link, paste the Link, copy the owner token, burn now, and open in browser.

Milestone 1 is a local developer extension in this repo. Raycast Store submission is Milestone 2 and requires a separate explicit release step.

## User Stories

1. As a Raycast user, I want to Poof selected text from any app, so that I can share transient text without opening the browser or terminal.
2. As a Raycast user, I want to Poof my clipboard text, so that I can turn copied content into an expiring Link with one command.
3. As a Raycast user, I want to Poof a file copied from Finder, so that I can share a file through p00f without using the web dropzone.
4. As a Raycast user, I want the extension to copy the Poof Link automatically, so that I can paste it into Slack, email, or a document immediately.
5. As a Raycast user, I want copied Poof Links to be concealed from Raycast Clipboard History, so that Raycast does not become a secondary history of Fragment Keys.
6. As a Raycast user, I want optional paste-after-create, so that I can choose a faster workflow while keeping the safer default.
7. As a Raycast user, I want quick commands to use my defaults, so that one hotkey is enough for common sharing.
8. As a Raycast user, I want a full Create Poof form, so that I can override TTL, Reveal budget, PIN, and policy flags per Poof.
9. As a Raycast user, I want a configurable hosted base URL, so that I can use `https://p00f.me` by default or point the extension at a self-hosted p00f instance.
10. As a Raycast user, I want default TTL and Reveal budget preferences, so that quick commands match my normal sharing policy.
11. As a Raycast user, I want custom TTL and Reveal budget values in the form, so that unusual shares do not require changing extension preferences.
12. As a Raycast user, I want selected and clipboard text to infer code the same way the web UI does, so that code snippets render as code on Reveal.
13. As a Raycast user, I want secret masking to be explicit, so that a quick command never silently changes recipient-side rendering semantics.
14. As a Raycast user, I want masked URL mode to be explicit in the form, so that ADR-0013's special rendering exception is a deliberate choice.
15. As a Raycast user, I want a PIN field in the form, so that I can add a server-side release gate and fold the PIN into the content key.
16. As a Raycast user, I want the form to validate PIN length, so that I learn about invalid input before upload.
17. As a Raycast user, I want a reveal-anchored TTL toggle, so that I can start the timer on first Reveal when the share is likely to sit unread.
18. As a Raycast user, I want a viewer-delete toggle, so that I can let recipients burn the Poof after they are done.
19. As a Raycast user, I want a reveal Turnstile requirement toggle, so that I can require recipients to use a browser captcha when the share needs a human gate.
20. As a Raycast user, I want a countdown toggle, so that I can decide whether recipients see the UX countdown.
21. As a Raycast user, I want a result screen after the full form creates a Poof, so that I can copy the Link, copy the owner token, burn early, or open the Link.
22. As a Raycast user, I want owner tokens to avoid persistence by default, so that p00f does not create a local registry of control tokens.
23. As a Raycast user, I want the owner token available on the result screen, so that I can keep it manually if I care about early burn.
24. As a Raycast user, I want quick commands to leave my clipboard alone on failure, so that failed creates do not destroy what I was about to paste.
25. As a Raycast user, I want friendly failure messages, so that I can tell the difference between missing selection, empty clipboard, rate limiting, size limits, and network failure.
26. As a Raycast user, I want oversized files rejected before upload, so that I do not waste time attempting a Poof that the server will reject.
27. As a Raycast user, I want clipboard handling to prefer a copied file over text when both are present, so that Finder-style file sharing behaves like the web paste flow.
28. As a Raycast user, I want HTML clipboard content treated as text, so that p00f never introduces a rich HTML rendering path without a separate hostile-rendering design.
29. As a p00f maintainer, I want the Raycast extension to import `@p00f/core` directly, so that all crypto stays in the audited core and no shell reimplements the zero-knowledge engine.
30. As a p00f maintainer, I want the Raycast extension to send no client-identifying headers, so that the server stays oblivious to whether a request came from Raycast, CLI, or another machine client.
31. As a p00f maintainer, I want Raycast creates to use the same anonymous machine-path floor as the CLI, so that no special entitlement exists for one desktop client.
32. As a p00f maintainer, I want the extension to never send fake Turnstile tokens, so that machine-path behavior stays honest and matches ADR-0011.
33. As a p00f maintainer, I want the extension developed locally in this repo first, so that shared helper extraction can happen before Raycast Store packaging.
34. As a p00f maintainer, I want Store submission separated from local build, so that publishing remains an explicit action.

## Implementation Decisions

- **Use `@p00f/core` directly.** The extension is a thin caller-side shell over the core, not a wrapper around the CLI and not a raw protocol reimplementation. This follows ADR-0010's one-core-many-shells model.
- **Develop under `packages/raycast/`.** Milestone 1 lives in this repo. Store submission later copies or normalizes the package into the Raycast Store workflow.
- **Local dependency uses `file:../core`.** For Milestone 1 the Raycast package depends on the local `@p00f/core` package and builds `packages/core` before Raycast dev/build. Milestone 2 changes the dependency to a published semver version after any needed core/helper updates are published.
- **Do not migrate the root package to npm workspaces for this feature.** That is more global repo churn than the Raycast extension needs.
- **Three command shape.** Ship two no-view commands for speed and one Form command for full control. Quick commands use preference defaults only. They do not accept Raycast command arguments in v1.
- **Create-only v1.** The Raycast extension creates Poofs only. Revealing from Raycast, `info`, and burn-by-pasted-token commands are out of scope for Milestone 1.
- **No owner-token persistence by default.** Quick commands copy only the Link. The full Form result screen exposes the owner token once and can burn immediately, but no Recent Poofs registry ships in v1.
- **Concealed clipboard writes.** Poof Links and owner tokens are copied through Raycast's concealed clipboard option so they are not recorded in Raycast Clipboard History.
- **Paste after create is opt-in.** Default behavior is concealed copy only. A `pasteAfterCreate` preference enables quick commands to paste the Link into the frontmost app after creation. The full result screen always has an explicit paste action.
- **No client-identifying headers.** The injected fetch must not add `X-Poof-Client`, custom user-agent, or any other Raycast-identifying header. Raycast is just another anonymous machine-path client.
- **No create-side Turnstile.** Raycast sends no create-side Turnstile token and no local-dev fake token. It sits under the hosted anonymous create floor like the CLI.
- **Rate limiting is accepted.** If the hosted service returns `429`, Raycast reports that p00f is rate limiting anonymous creates and leaves the clipboard untouched.
- **Preferences.** The extension preferences are `base`, `defaultTtl`, `defaultReveals`, `defaultRevealAnchored`, `defaultAllowViewerDelete`, `defaultRequireTurnstile`, `openInBrowserAfterCreate`, and `pasteAfterCreate`. A `rememberOwnerTokens` preference is deferred until Recent Poofs is designed.
- **Form overrides.** The full command form can override TTL, Reveal budget, PIN, secret kind, masked URL mode, reveal-anchored TTL, viewer-delete, reveal Turnstile requirement, and countdown behavior per Poof.
- **TTL and Reveal budget.** Presets mirror the web UI and CLI policy: TTL defaults to 5 minutes and is bounded by the shared 1 minute to 30 days range; Reveal budget defaults to 1 and supports 1 to 100 or unlimited.
- **Shared kind helpers.** Extract default create-kind helpers from web-only code into shared code so web, CLI, and Raycast agree on text/code/url/file inference. This should include code-looking text detection, lone http(s) URL detection, and file kind inference.
- **Quick text inference matches the web UI.** Selected text and clipboard text infer `code` only when the same web helper would infer code; otherwise `text`.
- **No hidden secret or masked URL magic.** Quick commands never silently create `secret` or `url` kinds. The Form exposes those as explicit toggles.
- **Clipboard priority.** `Poof Clipboard` reads one payload using this order: file path first, plain text second, HTML as text fallback third, then fail as empty or unsupported. Directories and multiple files are rejected in v1.
- **File kind inference.** File payloads infer `image`, `video`, `audio`, or `file` from MIME or extension in the same spirit as the web and CLI.
- **HTML clipboard fallback is text.** The extension must not add rich HTML rendering. HTML is treated as escaped text/code inside the existing reveal renderer.
- **Failure behavior.** Quick commands fail closed. On failure they do not replace or paste the clipboard. User-facing errors distinguish no selection, empty clipboard, unsupported clipboard, too large, rate limited, network failure, and generic create failure.
- **Result screen.** The full Form success state shows a Detail screen with actions for copy Link, paste Link, copy owner token, burn now, and open in browser.

## Testing Decisions

- **Test external behavior, not Raycast internals.** The valuable tests cover pure shared helpers, adapter behavior, option mapping, and create-service outcomes. Raycast command rendering is validated by Raycast build/lint and manual dev runs.
- **Shared create-kind helpers get unit tests.** Cover text vs code, lone http(s) URL detection, non-http(s) rejection for masked URL mode, file kind inference, and the guarantee that default inference never turns text into `secret` or `url` without an explicit caller choice.
- **Raycast option mapping gets unit tests.** Cover defaults from preferences, form overrides, custom TTL and Reveal budget, invalid PIN, mutually exclusive text/file, reveal-anchored TTL, viewer-delete, reveal Turnstile requirement, and countdown preference.
- **Raycast content adapters get unit tests.** Cover selected text, clipboard file priority, clipboard text fallback, HTML-as-text fallback, empty clipboard, unsupported clipboard, directories, and oversized files.
- **Create service gets unit tests with fake `fetch` and fake Raycast clipboard APIs.** Cover successful concealed copy, optional paste, no clipboard mutation on failure, `429` mapping, network failure mapping, and the absence of client-identifying headers.
- **Core zero-knowledge tests remain authoritative.** The Raycast extension should not duplicate crypto tests. Existing `@p00f/core` tests continue to prove that the Fragment Key never reaches the hosted API.
- **Build validation.** Milestone 1 requires `npm run build --prefix packages/core`, Raycast build/lint for `packages/raycast`, and the existing root `vitest` suite. Manual Raycast dev validation confirms all three commands work locally.

## Out of Scope

- Raycast Store submission, screenshots, Store metadata polish, and PR into `raycast/extensions`. This is Milestone 2.
- Revealing a Poof from Raycast.
- `info` from Raycast.
- Burn-by-pasted-token as a standalone command.
- Recent Poofs, persisted owner tokens, labels, expiry cleanup, or a local history dashboard.
- Any client-identifying headers or special server treatment for Raycast.
- API keys, bearer keys, OAuth, accounts, or any trusted Raycast entitlement.
- Rich HTML rendering.
- Multi-file sharing, zipping, folders, or multiple Poofs from one command.
- Raw image pasteboard formats unless Raycast exposes them as a single file-like item.
- A new server API endpoint.
- Any change to p00f's zero-knowledge trust model.

## Further Notes

- The extension should use public brand copy as `p00f` and domain language as **Poof**, **Reveal**, **Fragment Key**, **TTL**, and **Reveal budget**.
- The server remains intentionally oblivious to the caller surface. If the hosted anonymous create floor is hit, Raycast should report it and stop.
- The full Form's `requireTurnstile` flag means the recipient must solve a reveal-side Turnstile in a browser. It does not mean Raycast solves a create-side Turnstile.
- Store submission should happen only after Milestone 1 feels good locally and after any new shared helpers needed by Raycast are available through a published `@p00f/core` semver dependency.
