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
import { decideRender, buildSandboxMessage, safeHttpUrl, clampHeight, type SandboxMessage } from "./render";

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

// Plain text copy without a button-label swap. Used by the reveal-box corner
// copy icon (#15), which shows its own affordance via a .copied CSS class.
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard blocked */
  }
}

// ---------------- create ----------------

let pending: { bytes: Uint8Array; meta: ClipMeta } | null = null;
let lastClipId = "";
let lastOwnerToken = "";

// Composite create button (V6) controller, set up in initCreate.
let btnCtl: { startRing: () => void; stopRing: () => void; startIdle: () => void } | null = null;

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
  btnCtl = setupCreateButton();
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
  // Click the link field itself to copy it (#16). The copy-link button still
  // works; the field click is an additional, more discoverable affordance.
  // The transient affordance is borrowed from the existing button: we briefly
  // swap the button's label so the success cue is shown in a stable spot.
  $("#link").addEventListener("click", () => {
    const linkField = $("#link") as HTMLInputElement;
    if (!linkField.value || linkField.value === "(burned)") return;
    linkField.select();
    copyText(linkField.value, $("#copy-link"));
  });
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

// The create button is a small interactive scene on a canvas: a drifting glyph
// field at rest, a mono label that loops "create poof" <-> the bash command
// "$ poof" via an ascii scramble (no hover; works on touch), and on submit an
// ascii smoke ring that sweeps the whole button while the poof is created.
function setupCreateButton(): { startRing: () => void; stopRing: () => void; startIdle: () => void } | null {
  const btn = document.querySelector("#create-btn") as HTMLButtonElement | null;
  const cv = btn?.querySelector(".poof-field") as HTMLCanvasElement | null;
  const label = btn?.querySelector(".poof-label") as HTMLElement | null;
  const ctx = cv?.getContext("2d");
  if (!btn || !cv || !label || !ctx) return null;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0;
  let H = 0;
  const fit = () => {
    const r = btn.getBoundingClientRect();
    W = r.width;
    H = r.height;
    cv.width = Math.max(1, W * dpr);
    cv.height = Math.max(1, H * dpr);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
  };
  fit();
  window.addEventListener("resize", fit);

  const glyphs = "01<>/{}#*·°".split("");
  const bg = Array.from({ length: 34 }, () => ({
    x: Math.random() * Math.max(W, 1),
    y: Math.random() * Math.max(H, 1),
    ch: glyphs[(Math.random() * glyphs.length) | 0],
    a: 0.05 + Math.random() * 0.12,
    vy: -(4 + Math.random() * 9),
  }));
  let fieldRaf = 0;
  function fieldFrame() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '12px "SF Mono", ui-monospace, monospace';
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    for (const g of bg) {
      g.y += g.vy / 60;
      if (g.y < 0) {
        g.y = H;
        g.x = Math.random() * W;
      }
      ctx.fillStyle = `rgba(237,237,237,${g.a})`;
      ctx.fillText(g.ch, g.x, g.y);
    }
    fieldRaf = requestAnimationFrame(fieldFrame);
  }

  const LABEL = "create poof";
  const CMD = "$ poof";
  const SCR = "!<>-_\\/[]{}=+*?#@%".split("");
  let sraf = 0;
  let timer = 0;
  const settle = (html: string) => {
    label.classList.remove("scrambling");
    label.innerHTML = html;
  };
  function scramble(from: string, to: string, dur: number, onDone: () => void) {
    const n = Math.max(from.length, to.length);
    const q: { f: string; t: string; s: number; e: number; c: string }[] = [];
    for (let i = 0; i < n; i++) {
      const s = Math.floor(Math.random() * dur * 0.4);
      q.push({ f: from[i] || "", t: to[i] || "", s, e: s + Math.floor(dur * 0.35 + Math.random() * dur * 0.35), c: "" });
    }
    const t0 = performance.now();
    label.classList.add("scrambling");
    const step = (now: number) => {
      const t = now - t0;
      let out = "";
      let done = 0;
      for (const it of q) {
        if (t >= it.e) {
          done++;
          out += it.t;
        } else if (t >= it.s) {
          if (!it.c || Math.random() < 0.3) it.c = SCR[(Math.random() * SCR.length) | 0];
          out += it.c;
        } else out += it.f;
      }
      label.textContent = out;
      if (done === q.length) {
        onDone();
        return;
      }
      sraf = requestAnimationFrame(step);
    };
    sraf = requestAnimationFrame(step);
  }
  const toCmd = () => scramble(LABEL, CMD, 300, () => { settle('<span class="pr">$</span> poof'); timer = window.setTimeout(toLabel, 1300); });
  const toLabel = () => scramble(CMD, LABEL, 300, () => { settle("create poof"); timer = window.setTimeout(toCmd, 3000); });

  function startIdle() {
    cancelAnimationFrame(ringRaf);
    label.style.visibility = "visible";
    settle("create poof");
    clearTimeout(timer);
    timer = window.setTimeout(toCmd, 3000);
    cancelAnimationFrame(fieldRaf);
    fieldFrame();
  }
  function stopIdle() {
    clearTimeout(timer);
    cancelAnimationFrame(sraf);
    cancelAnimationFrame(fieldRaf);
  }

  let ringRaf = 0;
  function startRing() {
    stopIdle();
    label.style.visibility = "hidden";
    const t0 = performance.now();
    const ring = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const fs = 16;
      ctx.font = fs + 'px "SF Mono", ui-monospace, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const cw = ctx.measureText("M").width || fs * 0.6;
      const lh = Math.round(fs * 1.15);
      const cols = Math.max(8, Math.floor(W / cw));
      const rows = Math.max(5, Math.floor(H / lh));
      const cx = (cols - 1) / 2;
      const cy = (rows - 1) / 2;
      const aspect = lh / cw;
      const pal = ["✦", "*", "o", "°", "·"];
      const maxD = Math.hypot(cx, cy * aspect) + pal.length;
      const period = 520; // ms per sweep; loops while the create request is in flight
      const F = (((now - t0) % period) / period) * maxD;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - cx, (y - cy) * aspect);
          const k = Math.round(F - d);
          if (k >= 0 && k < pal.length) {
            ctx.fillStyle = k === 0 ? "#ff6363" : `rgba(255,99,99,${Math.max(0.15, 0.8 - k * 0.16)})`;
            ctx.fillText(pal[k], (x + 0.5) * cw, (y + 0.5) * lh);
          }
        }
      ringRaf = requestAnimationFrame(ring);
    };
    ringRaf = requestAnimationFrame(ring);
  }
  function stopRing() {
    cancelAnimationFrame(ringRaf);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
  }

  startIdle();
  return { startRing, stopRing, startIdle };
}

async function doCreate() {
  if (!pending) return;
  const btn = $("#create-btn") as HTMLButtonElement;
  if (btn.disabled) return;
  btn.disabled = true;
  show($("#create-error"), false);
  btnCtl?.startRing();
  // Always let the poof sweep at least once, even if the request is instant.
  const minPoof = new Promise<void>((r) => setTimeout(r, 560));
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
    await minPoof;
    btnCtl?.stopRing();
    show($("#composer"), false);
    show($("#result"), true);
  } catch (err) {
    btnCtl?.stopRing();
    btnCtl?.startIdle();
    $("#create-error").textContent = String(err);
    show($("#create-error"), true);
    btn.disabled = false;
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
        $("#precard-info").textContent = "too many wrong PINs. This poof is locked until it expires.";
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

// Inline copy icon for the reveal box corner affordance (#15). The icon lives
// in the key-holding parent, never inside the sandbox, so it has direct access
// to the decrypted bytes the user actually wants to copy. SVG markup is static
// and trusted; no user content flows in here.
const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

function makeCornerCopyIcon(onCopy: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "clip-copy-icon";
  btn.setAttribute("aria-label", "copy");
  btn.title = "copy";
  btn.innerHTML = COPY_ICON_SVG;
  btn.addEventListener("click", () => {
    void Promise.resolve(onCopy()).then(() => {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1200);
    });
  });
  return btn;
}

// Mount the revealed content in an opaque-origin sandboxed iframe (ADR-0012).
// sandbox="allow-scripts" without allow-same-origin gives the frame a unique
// opaque origin: even if a payload ran inside, it could not read the parent's
// location.hash (the Fragment Key), cookies, or storage. The frame loads the
// real /sandbox.html document (a real URL does not inherit the parent's strict
// CSP, unlike a blob/srcdoc/data frame). Plaintext bytes are handed in by
// postMessage only after the sandbox signals ready; the key is never posted.
//
// When `copy` is supplied, the iframe is wrapped in a positioned .clip-box and
// a corner copy icon is added (#15). The icon runs in the parent (which holds
// the decrypted bytes); the sandbox itself is never asked to handle the key.
function mountSandbox(host: HTMLElement, message: SandboxMessage, copy?: () => void | Promise<void>) {
  const iframe = document.createElement("iframe");
  iframe.className = "clip-frame";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.src = "/sandbox.html";

  const onMsg = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data === "poof-sandbox-ready") {
      iframe.contentWindow?.postMessage(message, "*");
      return;
    }
    // The sandbox posts {type:"poof-size", height} after rendering so the
    // reveal box auto-sizes to its content (#15). The message carries only a
    // number; the opaque-origin guarantee is unchanged. We keep the listener
    // attached past the handshake because the image branch posts its size
    // asynchronously after its load event.
    if (e.data && typeof e.data === "object" && (e.data as { type?: string }).type === "poof-size") {
      const raw = Number((e.data as { height?: number }).height);
      // +4px avoids a hairline scrollbar from sub-pixel rounding. The MAX is
      // clamped to a sensible portion of the viewport so a very tall payload
      // does not push the page chrome off-screen; the user can still drag the
      // .clip-frame resize handle to see more.
      const max = Math.min(600, Math.round(window.innerHeight * 0.6));
      iframe.style.height = clampHeight(raw + 4, 120, max) + "px";
    }
  };
  window.addEventListener("message", onMsg);

  if (copy) {
    const box = document.createElement("div");
    box.className = "clip-box";
    box.appendChild(iframe);
    box.appendChild(makeCornerCopyIcon(copy));
    host.appendChild(box);
  } else {
    host.appendChild(iframe);
  }
}

// Copy the decrypted image bytes to the system clipboard as an image item.
// Mirrors the existing "copy image" .actions button (#15: corner icon reuses
// the same logic, kept in one place so both stay in sync).
async function copyImageBytes(bytes: Uint8Array, mime: string): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })]);
  } catch {
    /* unsupported */
  }
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
      mountSandbox(host, buildSandboxMessage({ mode: "text" }, bytes), () => copyToClipboard(td.decode(bytes)));
    });
    const copyBtn = actionButton("copy", () => copyText(td.decode(bytes), copyBtn));
    actions.appendChild(showBtn);
    actions.appendChild(copyBtn);
  } else if (decision.mode === "image") {
    const imgMime = meta.mime ?? "image/png";
    mountSandbox(host, buildSandboxMessage(decision, bytes), () => copyImageBytes(bytes, imgMime));
    actions.appendChild(actionButton("copy image", () => copyImageBytes(bytes, imgMime)));
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
      // path so the bytes are shown but never clickable. The corner copy icon
      // (#15) shows its own affordance via the .copied class.
      mountSandbox(host, buildSandboxMessage({ mode: "text" }, bytes), () => copyToClipboard(text));
      const copyBtn = actionButton("copy", () => copyText(text, copyBtn));
      actions.appendChild(copyBtn);
    }
  } else {
    // text / code / unknown-but-UTF8
    const text = td.decode(bytes);
    mountSandbox(host, buildSandboxMessage(decision, bytes), () => copyToClipboard(text));
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
