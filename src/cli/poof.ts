// @ts-nocheck
// poof CLI (POOF-16, ADR-0010). A stateless shell over @p00f/core: all crypto is
// caller-side and only ciphertext reaches the server. stdout is the Link only;
// human chrome and the owner token go to stderr, so `LINK=$(poof file)` composes.
// (Add @types/node for full typing; this entrypoint runs only under Node.)
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { create, read, info, burn } from "../shared/core";
import { parseArgs, ttlToMs, readsToBudget, inferKind } from "./args";
import { webcrypto } from "node:crypto";

// Node 18 does not expose Web Crypto as a global; @p00f/core relies on it.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const BASE = process.env.POOF_BASE || process.env.P00F_BASE || "https://poof.localhost";
const http = (u, init) => fetch(u, init);

function die(msg, code) {
  process.stderr.write(msg + "\n");
  process.exit(code);
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

  const created = await create(http, BASE, {
    content,
    meta: { kind, filename, mime, size: content.length },
    ttlMs,
    revealBudget,
    pin,
    showCountdown,
  });

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
  const r = await read(http, link, { pin: typeof a.flags.pin === "string" ? a.flags.pin : undefined });
  if (!r.ok) {
    const code = r.reason === "gone" ? 3 : r.reason === "decrypt" ? 6 : 5;
    die(`could not read clip: ${r.reason}`, code);
  }
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
  process.stderr.write(`kind: ${i.meta?.kind ?? "?"}\nreveals left: ${reveals}\npin required: ${i.pinRequired}\n`);
}

async function cmdBurn(a) {
  const link = a.positional[0];
  const token = typeof a.flags.token === "string" ? a.flags.token : undefined;
  if (!link || !token) die("usage: poof burn <link> --token <ownerToken>", 2);
  const b = await burn(http, link, token);
  if (!b.ok) die("burn failed (wrong owner token or already gone)", 3);
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
