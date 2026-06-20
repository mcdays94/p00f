// Hostile-content render decisions for the web reveal path (ADR-0012). All
// revealed content is treated as attacker-controlled: this module decides how a
// Kind is dispositioned and builds the opaque-origin sandbox the content renders
// in. It is pure (no DOM), so the disposition rules are unit-tested directly.
//
// The Fragment Key is NEVER an input here. Decryption happens in the key-holding
// document; only the resulting plaintext bytes flow through these functions and
// into the sandbox, so the key cannot reach the sandbox by construction.
import type { ClipMeta } from "../shared/core";

export type RenderMode = "text" | "image" | "secret" | "download";

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
// - text / code: rendered as escaped text in the sandbox.
// - unknown kind: escaped text if it is valid UTF-8, otherwise a download.
export function decideRender(meta: ClipMeta, bytes: Uint8Array): RenderDecision {
  const kind = meta.kind;
  if (kind === "secret") return { mode: "secret" };
  if (isSvg(meta)) return { mode: "download", mime: "application/octet-stream", filename: meta.filename };
  if (kind === "image" || (meta.mime ?? "").startsWith("image/")) {
    return { mode: "image", mime: meta.mime ?? "application/octet-stream" };
  }
  if (kind === "file") return { mode: "download", mime: meta.mime, filename: meta.filename };
  if (kind === "text" || kind === "code") return { mode: "text" };
  // Unknown kind: safe-as-text when UTF-8, otherwise a download.
  return looksUtf8(bytes)
    ? { mode: "text" }
    : { mode: "download", mime: meta.mime, filename: meta.filename };
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Message posted into the sandbox. It carries only displayable plaintext (text)
// or raw image bytes plus a mime, never the key. The text branch sends a string
// the sandbox renders via textContent; the image branch sends bytes the sandbox
// wraps in a blob URL.
export type SandboxMessage =
  | { type: "poof-render"; mode: "text"; text: string }
  | { type: "poof-render"; mode: "image"; bytes: ArrayBuffer; mime: string };

// The plaintext bytes flow into the opaque-origin sandbox document
// (public/sandbox.html) through this message only. The sandbox renders text via
// textContent (never HTML) or an image via a blob URL. The key is never here.
export function buildSandboxMessage(decision: RenderDecision, bytes: Uint8Array): SandboxMessage {
  if (decision.mode === "image") {
    // Copy into a standalone ArrayBuffer so we never transfer (and detach) the
    // caller's cached bytes.
    const copy = bytes.slice();
    return { type: "poof-render", mode: "image", bytes: copy.buffer, mime: decision.mime ?? "application/octet-stream" };
  }
  // text and shown-secret both render as escaped text.
  return { type: "poof-render", mode: "text", text: tdLoose.decode(bytes) };
}
