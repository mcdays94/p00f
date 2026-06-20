import {
  generateMasterKey,
  generateClipId,
  encodeKey,
  decodeKey,
  encryptBlob,
  decryptBlob,
  base64urlDecode,
} from "../shared/crypto";
import { buildLink } from "../shared/link";
import type { ClipMeta } from "../shared/core";
import { decideRender, buildSandboxMessage, safeHttpUrl, type SandboxMessage } from "./render";

const te = new TextEncoder();
const td = new TextDecoder();

// kind is an arbitrary string carried inside the encrypted metadata (POOF-14);
// the server never learns it. The web app understands text, code, image, file,
// and secret, and falls back to text-or-download for anything else.

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const show = (el: HTMLElement, on: boolean) => {
  el.hidden = !on;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function looksLikeCode(s: string): boolean {
  return /\n/.test(s) && /[;{}<>]|=>|\bfunction\b|\bconst\b|\bdef\b|\bclass\b|\bimport\b|#include/.test(s);
}

// True when the textarea holds exactly one http(s) URL (a single token, no
// embedded whitespace). Returns the canonical href so the create flow stores
// a normalized destination; null means the input is not a lone URL and the
// "share as masked link" suggestion stays hidden. A bare `host:port` stays
// text by design (no scheme auto-prepend), per the ADR-0013 brief.
function loneHttpUrl(s: string): string | null {
  const t = s.trim();
  if (!t || /\s/.test(t)) return null;
  return safeHttpUrl(t);
}

async function copyText(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    /* clipboard blocked */
  }
}

// ---------------- create ----------------

let pending: { bytes: Uint8Array; meta: ClipMeta } | null = null;
let lastClipId = "";
let lastOwnerToken = "";

function setPending(bytes: Uint8Array, meta: ClipMeta) {
  pending = { bytes, meta };
  $("#kind").textContent =
    meta.kind + (meta.filename ? ` · ${meta.filename}` : "") + ` · ${formatSize(meta.size)}`;
  ($("#create-btn") as HTMLButtonElement).disabled = false;
}

function clearPending() {
  pending = null;
  $("#kind").textContent = "";
  ($("#create-btn") as HTMLButtonElement).disabled = true;
}

const secretOn = () => ($("#secret") as HTMLInputElement | null)?.checked ?? false;
const urlModeOn = () => ($("#url-mode") as HTMLInputElement | null)?.checked ?? false;

async function loadFile(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const kind: string = f.type.startsWith("image/") ? "image" : "file";
  ($("#text") as HTMLTextAreaElement).value = "";
  setPending(buf, { kind, filename: f.name, mime: f.type || "application/octet-stream", size: buf.length });
}

function turnstileToken(): string {
  const t = (window as unknown as { turnstile?: { getResponse?: () => string } }).turnstile;
  const r = t?.getResponse?.();
  // Dev/local fallback: the always-pass test secret accepts any token. In
  // production (real secret) this fallback fails verification, as intended.
  return r && r.length ? r : "tok";
}

function initCreate() {
  show($("#create-page"), true);
  const ta = $("#text") as HTMLTextAreaElement;

  const urlSuggest = $("#url-suggest");
  const urlToggle = $("#url-mode") as HTMLInputElement;

  const recomputeText = () => {
    const v = ta.value;
    if (!v) {
      show(urlSuggest, false);
      urlToggle.checked = false;
      return clearPending();
    }
    // Detect a lone http(s) URL (single token, http/https scheme). When the
    // suggestion fires the user can opt in via the masked-link toggle, which
    // sets kind="url" and stores the canonical href as the encrypted content.
    // If the input is no longer a lone URL, the suggestion hides and the
    // toggle is reset, so stale URL-mode never sticks to non-URL content.
    const urlHref = loneHttpUrl(v);
    show(urlSuggest, !!urlHref);
    if (!urlHref) urlToggle.checked = false;

    if (urlHref && urlToggle.checked) {
      const bytes = te.encode(urlHref);
      setPending(bytes, { kind: "url", mime: "text/plain", size: bytes.length });
      return;
    }
    const bytes = te.encode(v);
    const kind = secretOn() ? "secret" : looksLikeCode(v) ? "code" : "text";
    setPending(bytes, { kind, mime: "text/plain", size: bytes.length });
  };
  ta.addEventListener("input", recomputeText);
  // Toggling secret re-kinds pending text (a file keeps its image/file kind).
  $("#secret")?.addEventListener("change", () => {
    if (ta.value) recomputeText();
  });
  // Toggling the masked-link suggestion re-kinds pending text the same way.
  $("#url-mode")?.addEventListener("change", () => {
    if (ta.value) recomputeText();
  });

  ta.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file");
    if (item) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        void loadFile(f);
      }
    }
  });

  const dz = $("#dropzone");
  ["dragover", "dragenter"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
    }),
  );
  dz.addEventListener("drop", (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  ($("#file") as HTMLInputElement).addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void loadFile(f);
  });

  $("#create-btn").addEventListener("click", () => void doCreate());
  $("#copy-link").addEventListener("click", () => copyText(($("#link") as HTMLInputElement).value, $("#copy-link")));
  $("#new-clip").addEventListener("click", () => {
    location.href = "/";
  });
  $("#delete-now").addEventListener("click", () => void doDeleteNow());
}

async function doDeleteNow() {
  if (!lastClipId || !lastOwnerToken) return;
  const status = $("#delete-status");
  const deleteBtn = $("#delete-now") as HTMLButtonElement;
  const linkField = $("#link") as HTMLInputElement;
  const markDead = () => {
    deleteBtn.disabled = true;
    linkField.value = "(burned)";
  };
  try {
    const res = await fetch(`/api/clip/${lastClipId}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: lastOwnerToken }),
    });
    // Parse the body so we can tell "already gone" (a calm outcome, the clip
    // was lazily burned at reveal/expiry) from a real forbidden/error.
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (body.ok === true) {
      status.textContent = "burned. the link is now dead.";
      markDead();
    } else if (body.reason === "gone") {
      status.textContent = "Already expired or burned. Nothing left to delete.";
      markDead();
    } else {
      status.textContent = "delete failed.";
    }
  } catch {
    status.textContent = "delete failed.";
  }
  show(status, true);
}

async function doCreate() {
  if (!pending) return;
  const btn = $("#create-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Encrypting...";
  show($("#create-error"), false);
  try {
    const master = generateMasterKey();
    const id = generateClipId();
    const pinRaw = ($("#pin") as HTMLInputElement).value.trim();
    const pin = /^\d{4}$/.test(pinRaw) ? pinRaw : undefined;

    const metaCipher = await encryptBlob(master, id, "metadata", te.encode(JSON.stringify(pending.meta)));
    const contentCipher = await encryptBlob(master, id, "content", pending.bytes, pin);

    const fd = new FormData();
    fd.set("id", id);
    fd.set("turnstile", turnstileToken());
    fd.set("ttlMs", ($("#ttl") as HTMLSelectElement).value);
    fd.set("revealBudget", ($("#budget") as HTMLSelectElement).value);
    if (pin) fd.set("pin", pin);
    fd.set("meta", new Blob([metaCipher]));
    fd.set("content", new Blob([contentCipher]));

    const res = await fetch("/api/clip", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`create failed (${res.status})`);
    const { id: serverId, ownerToken } = (await res.json()) as { id: string; ownerToken: string };
    lastClipId = serverId;
    lastOwnerToken = ownerToken;

    const link = buildLink({ origin: location.origin, id: serverId, key: master });
    ($("#link") as HTMLInputElement).value = link;
    show($("#composer"), false);
    show($("#result"), true);
  } catch (err) {
    $("#create-error").textContent = String(err);
    show($("#create-error"), true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create link";
  }
}

// ---------------- reveal ----------------

const sessionCache = new Map<string, Uint8Array>();

function showGone() {
  show($("#precard"), false);
  show($("#revealed"), false);
  show($("#gone"), true);
}

async function initReveal(id: string, keyStr: string) {
  show($("#reveal-page"), true);
  if (!keyStr) return showGone();

  let master: Uint8Array;
  try {
    master = decodeKey(keyStr);
  } catch {
    return showGone();
  }

  let res: Response;
  try {
    res = await fetch(`/api/clip/${id}/meta`);
  } catch {
    return showGone();
  }
  if (res.status === 404) return showGone();

  const data = (await res.json()) as {
    exists: boolean;
    metadata: string;
    revealsRemaining: number | null;
    pinRequired: boolean;
  };
  if (!data.exists) return showGone();

  let meta: ClipMeta;
  try {
    const bytes = await decryptBlob(master, id, "metadata", base64urlDecode(data.metadata));
    meta = JSON.parse(td.decode(bytes)) as ClipMeta;
  } catch {
    $("#pc-detail").textContent = "could not decrypt (bad link)";
    show($("#precard"), true);
    return;
  }

  $("#pc-kind").textContent = meta.kind;
  $("#pc-detail").textContent = (meta.filename ? `${meta.filename} · ` : "") + formatSize(meta.size);
  $("#pc-reveals").textContent =
    data.revealsRemaining === null ? "unlimited reveals" : `${data.revealsRemaining} reveal(s) left`;
  if (data.pinRequired) show($("#pin-entry"), true);
  show($("#precard"), true);

  $("#reveal-btn").addEventListener("click", () => void doReveal(id, master, meta, data.pinRequired));
}

async function doReveal(id: string, master: Uint8Array, meta: ClipMeta, pinRequired: boolean) {
  const btn = $("#reveal-btn") as HTMLButtonElement;
  btn.disabled = true;
  show($("#precard-info"), false);
  try {
    let pin: string | undefined;
    let bytes = sessionCache.get(id);
    if (!bytes) {
      let init: RequestInit = { method: "POST" };
      if (pinRequired) {
        pin = ($("#reveal-pin") as HTMLInputElement).value.trim();
        if (!/^\d{4}$/.test(pin)) {
          $("#precard-info").textContent = "enter the 4-digit PIN";
          show($("#precard-info"), true);
          return;
        }
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin, turnstile: turnstileToken() }),
        };
      }
      const res = await fetch(`/api/clip/${id}/reveal`, init);
      if (res.status === 410) return showGone();
      if (res.status === 423) {
        $("#precard-info").textContent = "too many wrong PINs. This clip is locked until it expires.";
        show($("#precard-info"), true);
        return;
      }
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { attemptsLeft?: number };
        $("#precard-info").textContent =
          body.attemptsLeft != null ? `wrong PIN. ${body.attemptsLeft} attempt(s) left.` : "PIN required.";
        show($("#precard-info"), true);
        return;
      }
      if (!res.ok) {
        $("#precard-info").textContent = "reveal failed";
        show($("#precard-info"), true);
        return;
      }
      const cipher = new Uint8Array(await res.arrayBuffer());
      bytes = await decryptBlob(master, id, "content", cipher, pin);
      sessionCache.set(id, bytes);
    }
    renderContent(bytes, meta);
    show($("#precard"), false);
    show($("#revealed"), true);
  } catch {
    $("#precard-info").textContent = "decryption failed";
    show($("#precard-info"), true);
  } finally {
    btn.disabled = false;
  }
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function download(bytes: Uint8Array, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Mount the revealed content in an opaque-origin sandboxed iframe (ADR-0012).
// sandbox="allow-scripts" without allow-same-origin gives the frame a unique
// opaque origin: even if a payload ran inside, it could not read the parent's
// location.hash (the Fragment Key), cookies, or storage. The frame loads the
// real /sandbox.html document (a real URL does not inherit the parent's strict
// CSP, unlike a blob/srcdoc/data frame). Plaintext bytes are handed in by
// postMessage only after the sandbox signals ready; the key is never posted.
function mountSandbox(host: HTMLElement, message: SandboxMessage) {
  const iframe = document.createElement("iframe");
  iframe.className = "clip-frame";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.src = "/sandbox.html";
  const onMsg = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data === "poof-sandbox-ready") {
      iframe.contentWindow?.postMessage(message, "*");
      window.removeEventListener("message", onMsg);
    }
  };
  window.addEventListener("message", onMsg);
  host.appendChild(iframe);
}

function renderContent(bytes: Uint8Array, meta: ClipMeta) {
  const host = $("#content");
  host.innerHTML = "";
  const decision = decideRender(meta, bytes);
  const actions = document.createElement("div");
  actions.className = "actions";

  if (decision.mode === "download") {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `${meta.filename ?? meta.kind} · ${formatSize(meta.size)} · download only`;
    host.appendChild(p);
    actions.appendChild(
      actionButton("download", () =>
        download(bytes, decision.filename ?? meta.filename ?? "clip", decision.mime ?? "application/octet-stream"),
      ),
    );
  } else if (decision.mode === "secret") {
    // Masked until the viewer chooses to show it (shoulder-surfing guard). Copy
    // works without putting the value on screen. Showing renders in the sandbox.
    const mask = document.createElement("p");
    mask.className = "secret-mask";
    mask.textContent = "\u2022".repeat(16);
    host.insertBefore(mask, null);
    const showBtn = actionButton("show", () => {
      mask.remove();
      showBtn.remove();
      mountSandbox(host, buildSandboxMessage({ mode: "text" }, bytes));
    });
    const copyBtn = actionButton("copy", () => copyText(td.decode(bytes), copyBtn));
    actions.appendChild(showBtn);
    actions.appendChild(copyBtn);
  } else if (decision.mode === "image") {
    mountSandbox(host, buildSandboxMessage(decision, bytes));
    actions.appendChild(
      actionButton("copy image", async () => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [meta.mime ?? "image/png"]: new Blob([bytes], { type: meta.mime ?? "image/png" }) }),
          ]);
        } catch {
          /* unsupported */
        }
      }),
    );
    actions.appendChild(actionButton("download", () => download(bytes, meta.filename ?? "image", meta.mime ?? "image/png")));
  } else if (decision.mode === "link") {
    // Masked URL (ADR-0013). Rendered in the key-holding parent (the sandbox
    // cannot open a new tab), so the safeHttpUrl scheme allowlist is the
    // load-bearing control: only http(s) destinations ever become clickable.
    // A `javascript:` / `data:` payload would run in the parent origin and
    // exfiltrate the Fragment Key, so any non-http(s) content falls back to
    // the regular escaped-text-in-the-sandbox path (no clickable href).
    const text = td.decode(bytes);
    const validated = safeHttpUrl(text);
    if (validated) {
      const a = document.createElement("a");
      // textContent (never innerHTML) so even http(s) destinations cannot
      // smuggle markup into the parent document.
      a.textContent = validated;
      a.href = validated;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "clip-link";
      host.appendChild(a);
      actions.appendChild(
        actionButton("open link", () => {
          window.open(validated, "_blank", "noopener,noreferrer");
        }),
      );
      const copyBtn = actionButton("copy", () => copyText(validated, copyBtn));
      actions.appendChild(copyBtn);
    } else {
      // Hostile or malformed scheme: fall back to the escaped-text sandbox
      // path so the bytes are shown but never clickable.
      mountSandbox(host, buildSandboxMessage({ mode: "text" }, bytes));
      const copyBtn = actionButton("copy", () => copyText(text, copyBtn));
      actions.appendChild(copyBtn);
    }
  } else {
    // text / code / unknown-but-UTF8
    const text = td.decode(bytes);
    mountSandbox(host, buildSandboxMessage(decision, bytes));
    const copyBtn = actionButton("copy", () => copyText(text, copyBtn));
    actions.appendChild(copyBtn);
  }
  host.appendChild(actions);
}

// ---------------- router ----------------

function main() {
  const m = location.pathname.match(/^\/c\/([^/]+)$/);
  if (m) {
    void initReveal(m[1], location.hash.slice(1));
  } else {
    initCreate();
  }
}

main();
