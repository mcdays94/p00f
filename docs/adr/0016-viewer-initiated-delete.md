# 0016 - Viewer-initiated delete is an opt-in creator flag, default off

**Status:** accepted (extends ADR-0008, builds on ADR-0015)

ADR-0008 gives the creator an owner token to burn a poof early, and is careful that the token is never carried in the Link, so a mere link-holder cannot destroy the poof. That is the right default. But there is a real use case for the opposite: a creator who wants the recipient to be able to destroy the poof the moment they are done with it ("you've read it, now make it disappear for everyone"). This ADR adds that as an explicit, per-clip, creator-set choice, default off, mirroring the opt-in shape of the reveal-Turnstile flag (ADR-0015).

## Decisions

- **Viewer-delete is a per-clip, creator-set flag, default off.** The create form carries `allowViewerDelete` (a DO column `allow_viewer_delete`); when unset, only the owner token can burn the poof, exactly as before. The default poof is unchanged: holding the link does not grant destruction.
- **It is enforced server-side, in the Durable Object.** A new endpoint `POST /api/clip/:id/burn` takes no owner token and calls `ClipDO.deleteByViewer()`, which burns only when `allow_viewer_delete = 1`. When the flag is unset the DO returns `forbidden` (HTTP 403), so a patched client or a raw API caller cannot delete a poof the creator did not open up. A missing row is `gone` (HTTP 200), treated as success since the destroy intent is already satisfied (same as the owner path).
- **It is a separate endpoint from the owner burn.** `/api/clip/:id/delete` stays owner-gated (`{ ownerToken }`); `/api/clip/:id/burn` is the tokenless viewer path. Keeping them distinct means the owner path is never ambiguous and the viewer path can never be tricked into accepting a token it should ignore.
- **`allowViewerDelete` is published in the cleartext envelope.** Alongside `pinRequired` and `turnstileRequired`, it lets a client (or agent) decide whether to offer a delete affordance. It leaks only the creator's policy choice, never content, consistent with the other cleartext policy flags.
- **The web affordance appears after reveal only.** The recipient sees a "delete now" button on the revealed panel, not on the precard: the intended flow is read-then-destroy. The current viewer keeps the content they already decrypted on screen; the burn just removes it for anyone else.
- **CLI/agent parity.** `@p00f/core` `burn()` with no owner token, and `poof burn <link>` with no `--token`, hit the viewer path. `poof info` and the discovery doc/`llms.txt` advertise `allowViewerDelete` so an agent knows the link can self-destruct.

## Considered options

- **Always let the viewer delete:** rejected. It would let anyone with the link destroy any poof, breaking ADR-0008's guarantee that the link is a read capability, not a destroy capability.
- **Reuse the owner `/delete` endpoint with an empty token:** rejected. Overloading one endpoint with two trust models invites a bug where a missing-token path is accidentally treated as authorized. A separate, clearly-named endpoint is safer.
- **Put the flag in the encrypted metadata instead of cleartext:** rejected. The server must enforce the opt-in, so it has to see it. Encrypting it would force the server to trust the client's claim, defeating the enforcement.
- **Default on:** rejected. The safe default is that a shared link cannot destroy the poof; making the recipient a destroyer is the exception a creator opts into.

## Consequences

- **A new way for a poof to end.** When the creator opts in, any link-holder can end the poof for everyone before its TTL or reveal budget, with no owner token. This is intended and is surfaced plainly in the UI copy and the wire format. For the default poof (flag off) nothing changes.
- **DO schema** gains `allow_viewer_delete` with an additive, idempotent `ALTER TABLE ... ADD COLUMN` migration (ADR-0015 pattern), so clips created before this change keep working and default to off.
- **Wire format** gains a cleartext `allowViewerDelete` and a `POST /api/clip/:id/burn` endpoint; `@p00f/core`, the envelope, the discovery doc, and `llms.txt` are updated together so the contract cannot drift.
- **Zero-knowledge is unaffected.** The viewer-burn endpoint carries no key material and returns no content; it only destroys. The flag is policy, not plaintext.
