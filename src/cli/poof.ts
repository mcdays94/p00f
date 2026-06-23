// @ts-nocheck
// poof CLI (POOF-16, ADR-0010). A stateless shell over @p00f/core: all crypto is
// caller-side and only ciphertext reaches the server. stdout is the Link only;
// human chrome and the owner token go to stderr, so `LINK=$(poof file)` composes.
// (Add @types/node for full typing; this entrypoint runs only under Node.)
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { create, read, info, burn } from "../shared/core";
import { parseArgs, ttlToMs, readsToBudget, inferKind, wantsAnimation, poofFrame, coral } from "./args";
import { MAX_CLIP_BYTES, formatBytes } from "../shared/limits";
import { resolveBase } from "../shared/base";
import { webcrypto } from "node:crypto";

// Node 18 does not expose Web Crypto as a global; @p00f/core relies on it.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const BASE = resolveBase(process.env);
const http = (u, init) => fetch(u, init);

function die(msg, code) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

// The stderr "poof" animation (#26): a smoke-puff spinner drawn while a poof is
// being created or revealed. stdout stays the link/content only, so it composes
// in pipelines; the gate (TTY, not --json, not --no-animation) is wantsAnimation.
// Returns a stop() that erases the spinner line and restores the cursor; call it
// in a finally so an error still leaves the terminal clean.
function startPoofAnimation(label) {
  let tick = 0;
  // The spinner only runs on a TTY (wantsAnimation gated it), so color is safe;
  // still honour NO_COLOR (present at any value, including empty, disables it).
  const colorOn = !("NO_COLOR" in process.env);
  const draw = () =>
    process.stderr.write("\r\x1b[2K" + poofFrame(label, tick++, (g) => coral(g, colorOn)));
  process.stderr.write("\x1b[?25l"); // hide cursor
  draw();
  const id = setInterval(draw, 110);
  if (typeof id.unref === "function") id.unref(); // never keep the process alive
  return () => {
    clearInterval(id);
    process.stderr.write("\r\x1b[2K\x1b[?25h"); // clear line + restore cursor
  };
}

function maybeAnimate(flags, label) {
  return wantsAnimation(flags, process.stderr.isTTY === true) ? startPoofAnimation(label) : null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

function guessMime(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return {
    txt: "text/plain", md: "text/markdown", json: "application/json", js: "text/javascript",
    ts: "text/typescript", csv: "text/csv", html: "text/html", png: "image/png",
    jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  }[ext];
}

function isBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function resolvePin(flags) {
  if (typeof flags.pin === "string") return flags.pin;
  if (flags.pin === true) {
    return (
      process.env.POOF_PIN ||
      die("provide the PIN as --pin 1234 or via POOF_PIN (interactive prompt not yet supported)", 2)
    );
  }
  return undefined;
}

async function cmdCreate(a) {
  const path = a.positional[0];
  let content, filename, mime;
  if (path && path !== "-") {
    content = new Uint8Array(readFileSync(path));
    filename = basename(path);
    mime = guessMime(filename);
  } else {
    if (process.stdin.isTTY) die("nothing to create: pass a file path or pipe content on stdin", 2);
    content = await readStdin();
  }
  if (!content.length) die("nothing to create: empty input", 2);
  if (content.length > MAX_CLIP_BYTES)
    die(`too big (${formatBytes(content.length)}); max is ${formatBytes(MAX_CLIP_BYTES)} per poof`, 2);

  let ttlMs, revealBudget;
  try {
    ttlMs = ttlToMs(a.flags.ttl);
    revealBudget = readsToBudget(a.flags.reads);
  } catch (e) {
    die(String(e?.message || e), 2);
  }
  const pin = resolvePin(a.flags);
  const kind = inferKind({
    explicit: typeof a.flags.kind === "string" ? a.flags.kind : undefined,
    mime,
    filename,
    isBinary: isBinary(content),
  });

  // --no-countdown folds ClipMeta.showCountdown=false into the encrypted
  // metadata (ADR-0014); default leaves the recipient countdown on.
  const showCountdown = a.flags["no-countdown"] ? false : undefined;
  // --require-turnstile gates reveal behind a human captcha (ADR-0015). Default
  // off so the poof another agent receives stays revealable from the CLI/API.
  const requireTurnstile = a.flags["require-turnstile"] ? true : undefined;
  // --viewer-delete lets any link-holder burn this poof early, with no owner
  // token (ADR-0016). Default off.
  const allowViewerDelete = a.flags["viewer-delete"] ? true : undefined;
  // --reveal-anchored starts the ttl clock at the first reveal instead of at
  // create (ADR-0017): the link waits (up to the 30-day unrevealed cap) until
  // first revealed, then burns ttl later. Default off.
  const revealAnchored = a.flags["reveal-anchored"] ? true : undefined;

  const stopAnim = maybeAnimate(a.flags, "poofing");
  let created;
  try {
    created = await create(http, BASE, {
      content,
      meta: { kind, filename, mime, size: content.length },
      ttlMs,
      revealBudget,
      pin,
      showCountdown,
      requireTurnstile,
      allowViewerDelete,
      revealAnchored,
    });
  } finally {
    stopAnim?.();
  }

  if (a.flags.json) {
    process.stdout.write(JSON.stringify({ link: created.link, id: created.id, ownerToken: created.ownerToken }) + "\n");
  } else {
    process.stdout.write(created.link + "\n");
    process.stderr.write(`owner token (keep it to burn early; not stored anywhere): ${created.ownerToken}\n`);
  }
}

async function cmdGet(a) {
  const link = a.positional[0];
  if (!link) die("usage: poof get <link> [--out FILE] [--pin 1234]", 2);
  const stopAnim = maybeAnimate(a.flags, "revealing");
  let r;
  try {
    r = await read(http, link, { pin: typeof a.flags.pin === "string" ? a.flags.pin : undefined });
  } finally {
    stopAnim?.();
  }
  if (!r.ok) {
    if (r.reason === "turnstile")
      die("this poof requires a human captcha to reveal; open the link in a browser", 7);
    const code = r.reason === "gone" ? 3 : r.reason === "decrypt" ? 6 : 5;
    die(`could not read clip: ${r.reason}`, code);
  }
  // The server discloses the authoritative deadline on a successful reveal
  // (ADR-0017). For a reveal-anchored poof this reveal just armed it; surface it
  // as chrome on stderr so stdout stays the content only.
  if (typeof r.expiresAt === "number")
    process.stderr.write(`expires at: ${new Date(r.expiresAt).toISOString()}\n`);
  const buf = Buffer.from(r.content);
  const out = typeof a.flags.out === "string" ? a.flags.out : undefined;
  if (out) {
    writeFileSync(out, buf);
    process.stderr.write(`wrote ${buf.length} bytes to ${out}\n`);
    return;
  }
  if (isBinary(r.content) && process.stdout.isTTY) die("binary content; use --out FILE to save it", 2);
  process.stdout.write(buf);
}

async function cmdInfo(a) {
  const link = a.positional[0];
  if (!link) die("usage: poof info <link>", 2);
  const i = await info(http, link);
  if (!i.exists) die("clip is gone (expired, burned, or wrong link)", 3);
  if (a.flags.json) {
    process.stdout.write(JSON.stringify(i) + "\n");
    return;
  }
  const reveals = i.revealsRemaining === null ? "unlimited" : String(i.revealsRemaining);
  process.stderr.write(
    `kind: ${i.meta?.kind ?? "?"}\nreveals left: ${reveals}\npin required: ${i.pinRequired}\ncaptcha required: ${i.turnstileRequired}\nviewer delete: ${i.allowViewerDelete}\nreveal-anchored: ${i.meta?.revealAnchored === true}\n`,
  );
}

async function cmdBurn(a) {
  const link = a.positional[0];
  const token = typeof a.flags.token === "string" ? a.flags.token : undefined;
  if (!link) die("usage: poof burn <link> [--token <ownerToken>]", 2);
  // No token: viewer-initiated burn (ADR-0016), honored only if the creator
  // allowed it. With a token: the owner-gated burn (ADR-0008).
  const b = await burn(http, link, token);
  if (!b.ok) {
    if (b.reason === "forbidden")
      die("this poof does not allow viewer delete; only the owner can burn it (pass --token)", 4);
    die(
      token
        ? "burn failed (wrong owner token or already gone)"
        : "burn failed (already gone, or viewer delete not allowed)",
      3,
    );
  }
  process.stderr.write("burned. the link is now dead.\n");
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  try {
    if (a.command === "create") await cmdCreate(a);
    else if (a.command === "get") await cmdGet(a);
    else if (a.command === "info") await cmdInfo(a);
    else if (a.command === "burn") await cmdBurn(a);
  } catch (e) {
    die(String(e?.message || e), 1);
  }
}

main();
