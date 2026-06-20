// Hostile-content render decisions for the web reveal path (ADR-0012). All
// revealed content is treated as attacker-controlled: this module decides how a
// Kind is dispositioned and builds the opaque-origin sandbox the content renders
// in. It is pure (no DOM), so the disposition rules are unit-tested directly.
//
// The Fragment Key is NEVER an input here. Decryption happens in the key-holding
// document; only the resulting plaintext bytes flow through these functions and
// into the sandbox, so the key cannot reach the sandbox by construction.
import type { ClipMeta } from "../shared/core";

export type RenderMode = "text" | "code" | "image" | "secret" | "link" | "download";

export interface RenderDecision {
  mode: RenderMode;
  mime?: string;
  filename?: string;
}

// Fatal decoder: throws on invalid UTF-8, so we can tell text from binary.
const tdFatal = new TextDecoder("utf-8", { fatal: true });
// Loose decoder: for display of content already known to be text.
const tdLoose = new TextDecoder();

// True when bytes are clean UTF-8 text with no NUL, so showing them as escaped
// text is sensible rather than forcing a download.
export function looksUtf8(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    tdFatal.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function isSvg(meta: ClipMeta): boolean {
  return meta.kind === "svg" || (meta.mime ?? "").toLowerCase().includes("svg");
}

// Disposition for a revealed clip (ADR-0012):
// - secret: masked until the viewer chooses to show it, then rendered as text.
// - SVG: always a download, never inline (SVG can carry script).
// - image (non-SVG): rendered in the sandbox.
// - file: download.
// - text: rendered as escaped text in the sandbox (textContent).
// - code: rendered in the sandbox with the inlined highlighter (POOF-11).
//   Highlighting tokenizes the source and writes each token via textContent,
//   so a code payload that contains raw HTML stays inert.
// - url (masked URL, ADR-0013): rendered in the key-holding parent as a
//   clickable anchor, BUT only after safeHttpUrl validates the destination.
//   The sandbox cannot open a new tab, which is why this Kind is the one
//   narrow exception to ADR-0012's sandbox-everything rule. The scheme
//   allowlist (safeHttpUrl) is the load-bearing control that stops a
//   `javascript:` or `data:` payload from running in the parent origin.
// - unknown kind: escaped text if it is valid UTF-8, otherwise a download.
export function decideRender(meta: ClipMeta, bytes: Uint8Array): RenderDecision {
  const kind = meta.kind;
  if (kind === "secret") return { mode: "secret" };
  if (isSvg(meta)) return { mode: "download", mime: "application/octet-stream", filename: meta.filename };
  if (kind === "image" || (meta.mime ?? "").startsWith("image/")) {
    return { mode: "image", mime: meta.mime ?? "application/octet-stream" };
  }
  if (kind === "file") return { mode: "download", mime: meta.mime, filename: meta.filename };
  if (kind === "url") return { mode: "link" };
  if (kind === "code") return { mode: "code" };
  if (kind === "text") return { mode: "text" };
  // Unknown kind: safe-as-text when UTF-8, otherwise a download.
  return looksUtf8(bytes)
    ? { mode: "text" }
    : { mode: "download", mime: meta.mime, filename: meta.filename };
}

// Scheme allowlist for the url Kind (ADR-0013). Returns the canonical href
// (URL.href, lowercased scheme, default-port normalization) ONLY when the
// destination parses as a URL and uses http: or https:; otherwise null.
// Any other scheme (javascript:, data:, vbscript:, file:, blob:, ftp:, ws:,
// mailto:, tel:, about:, custom:, ...) yields null, and the renderer falls
// back to escaped-text-in-the-sandbox. The reveal path must never assign an
// href before this returns a non-null value: a `javascript:` href would run
// in the key-holding parent origin and exfiltrate the Fragment Key.
export function safeHttpUrl(s: string): string | null {
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    return null;
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Message posted into the sandbox. It carries only displayable plaintext (text
// or code) or raw image bytes plus a mime, never the key. The text and code
// branches send a string the sandbox renders via textContent (text) or via the
// inlined highlighter (code, still token-by-token textContent). The image
// branch sends bytes the sandbox wraps in a blob URL.
export type SandboxMessage =
  | { type: "poof-render"; mode: "text"; text: string }
  | { type: "poof-render"; mode: "code"; text: string }
  | { type: "poof-render"; mode: "image"; bytes: ArrayBuffer; mime: string };

// The plaintext bytes flow into the opaque-origin sandbox document
// (public/sandbox.html) through this message only. The sandbox renders text via
// textContent (never HTML), code via the inlined highlighter (token text still
// rendered via textContent), or an image via a blob URL. The key is never here.
export function buildSandboxMessage(decision: RenderDecision, bytes: Uint8Array): SandboxMessage {
  if (decision.mode === "image") {
    // Copy into a standalone ArrayBuffer so we never transfer (and detach) the
    // caller's cached bytes.
    const copy = bytes.slice();
    return { type: "poof-render", mode: "image", bytes: copy.buffer, mime: decision.mime ?? "application/octet-stream" };
  }
  if (decision.mode === "code") {
    return { type: "poof-render", mode: "code", text: tdLoose.decode(bytes) };
  }
  // text and shown-secret both render as escaped text.
  return { type: "poof-render", mode: "text", text: tdLoose.decode(bytes) };
}
