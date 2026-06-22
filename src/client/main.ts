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
import { isValidPin, PIN_MIN_LEN, PIN_MAX_LEN } from "../shared/pin";
import { MAX_CLIP_BYTES, formatBytes, clampTtlMs, clampRevealBudget } from "../shared/limits";
import { decideRender, buildSandboxMessage, safeHttpUrl, clampHeight, formatRemaining, countdownFraction, type SandboxMessage } from "./render";

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

// Snarky one-liners for the share sheet; one is picked at random per share so it
// stays fresh. House style: no em-dashes.
const SHARE_BLURBS = [
  "Psst. Open this before it ghosts you.",
  "A secret, just for you. Read fast, it self-destructs.",
  "Top secret. This one actually self-destructs.",
];

// Native share sheet for the generated link (great on mobile). Falls back to a
// copy if the user cancels or the platform rejects the payload. Only the link
// is shared; the Fragment Key is in the link, so anyone shared-with can decrypt.
async function shareLink(): Promise<void> {
  const url = ($("#link") as HTMLInputElement).value;
  if (!url || url === "(burned)") return;
  const text = SHARE_BLURBS[(Math.random() * SHARE_BLURBS.length) | 0];
  try {
    await navigator.share({ title: "p00f", text, url });
  } catch {
    /* user cancelled, or share unavailable: leave the copy button as the fallback */
  }
}

// ---------------- create ----------------

let pending: { bytes: Uint8Array; meta: ClipMeta } | null = null;
let lastClipId = "";
let lastOwnerToken = "";

// Composite poof-button controllers (V6). The create button is set up in
// initCreate; the reveal button (same animation) is set up in initReveal.
type PoofBtnCtl = { startRing: () => void; stopRing: () => void; startIdle: () => void };
let btnCtl: PoofBtnCtl | null = null;
let revealCtl: PoofBtnCtl | null = null;

function setPending(bytes: Uint8Array, meta: ClipMeta) {
  // Pre-upload guard (friendly fast-fail): reject oversized content in the
  // browser instead of uploading it just to get a 413 back. The Worker's check
  // on the encrypted blob stays the authoritative cap.
  if (meta.size > MAX_CLIP_BYTES) {
    $("#create-error").textContent = `that's too big (${formatBytes(meta.size)}). Max is ${formatBytes(MAX_CLIP_BYTES)} per poof.`;
    show($("#create-error"), true);
    clearPending();
    return;
  }
  show($("#create-error"), false);
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
  const t = f.type;
  const kind: string = t.startsWith("image/")
    ? "image"
    : t.startsWith("video/")
      ? "video"
      : t.startsWith("audio/")
        ? "audio"
        : "file";
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

// Opt-in persistence of the non-secret create settings (ttl, reveal budget,
// show-countdown, require-captcha). localStorage, not a cookie: these are pure
// client-side UI preferences with no server use, so they never leave the
// browser (keeping the zero-knowledge posture). The PIN/password, the secret
// toggle, and the content are deliberately never persisted.
const PREFS_KEY = "poof:prefs";
interface Prefs {
  ttlMs?: string;
  revealBudget?: string;
  ttlNum?: string;
  ttlUnit?: string;
  budgetNum?: string;
  showCountdown?: boolean;
  requireTurnstile?: boolean;
}

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : null;
  } catch {
    return null;
  }
}

function currentPrefs(): Prefs {
  return {
    ttlMs: ($("#ttl") as HTMLSelectElement).value,
    revealBudget: ($("#budget") as HTMLSelectElement).value,
    ttlNum: ($("#ttl-num") as HTMLInputElement).value,
    ttlUnit: ($("#ttl-unit") as HTMLSelectElement).value,
    budgetNum: ($("#budget-num") as HTMLInputElement).value,
    showCountdown: ($("#show-countdown") as HTMLInputElement).checked,
    requireTurnstile: ($("#require-turnstile") as HTMLInputElement).checked,
  };
}

// Apply saved prefs into the actual form controls so the restored state is
// always visible (never a silent surprise). Stale select values that are no
// longer offered are ignored.
function applyPrefs(p: Prefs) {
  const ttl = $("#ttl") as HTMLSelectElement;
  const budget = $("#budget") as HTMLSelectElement;
  if (p.ttlMs && [...ttl.options].some((o) => o.value === p.ttlMs)) ttl.value = p.ttlMs;
  if (p.revealBudget && [...budget.options].some((o) => o.value === p.revealBudget)) budget.value = p.revealBudget;
  if (p.ttlNum) ($("#ttl-num") as HTMLInputElement).value = p.ttlNum;
  if (p.ttlUnit) ($("#ttl-unit") as HTMLSelectElement).value = p.ttlUnit;
  if (p.budgetNum) ($("#budget-num") as HTMLInputElement).value = p.budgetNum;
  if (typeof p.showCountdown === "boolean") ($("#show-countdown") as HTMLInputElement).checked = p.showCountdown;
  if (typeof p.requireTurnstile === "boolean") ($("#require-turnstile") as HTMLInputElement).checked = p.requireTurnstile;
  syncCustomFields();
}

function setupPrefs() {
  const remember = $("#remember-prefs") as HTMLInputElement | null;
  if (!remember) return;
  const reset = $("#reset-prefs") as HTMLButtonElement | null;

  const saved = readPrefs();
  if (saved) {
    applyPrefs(saved);
    remember.checked = true;
    // Open the panel so the restored (possibly non-default) settings are seen.
    const det = document.querySelector(".more-options") as HTMLDetailsElement | null;
    if (det) det.open = true;
  }

  const persistIfOn = () => {
    if (!remember.checked) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(currentPrefs()));
    } catch {
      /* storage blocked or full: persistence is best-effort */
    }
  };
  ["#ttl", "#budget", "#ttl-num", "#ttl-unit", "#budget-num", "#show-countdown", "#require-turnstile"].forEach((sel) =>
    $(sel)?.addEventListener("change", persistIfOn),
  );
  remember.addEventListener("change", () => {
    if (remember.checked) persistIfOn();
    else {
      try {
        localStorage.removeItem(PREFS_KEY);
      } catch {
        /* ignore */
      }
    }
  });
  reset?.addEventListener("click", () => {
    ($("#ttl") as HTMLSelectElement).value = "300000";
    ($("#budget") as HTMLSelectElement).value = "1";
    syncCustomFields();
    ($("#show-countdown") as HTMLInputElement).checked = true;
    ($("#require-turnstile") as HTMLInputElement).checked = false;
    remember.checked = false;
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      /* ignore */
    }
  });
}

// Reveal the custom TTL / reveal-count inputs only when the matching select is
// set to "custom" (#22). Module-scope so initCreate and applyPrefs can both use it.
function syncCustomFields(): void {
  const ttl = $("#ttl") as HTMLSelectElement | null;
  const budget = $("#budget") as HTMLSelectElement | null;
  const ttlWrap = $("#ttl-custom-wrap");
  const budgetWrap = $("#budget-custom-wrap");
  if (ttl && ttlWrap) show(ttlWrap, ttl.value === "custom");
  if (budget && budgetWrap) show(budgetWrap, budget.value === "custom");
}

function initCreate() {
  show($("#create-page"), true);
  btnCtl = setupPoofButton("#create-btn", "create poof", "$ poof");
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

  // Custom TTL / reveal-count inputs (#22): reveal the matching input when its
  // select is on "custom".
  $("#ttl")?.addEventListener("change", syncCustomFields);
  $("#budget")?.addEventListener("change", syncCustomFields);
  syncCustomFields();

  $("#create-btn").addEventListener("click", () => void doCreate());
  $("#copy-link").addEventListener("click", () => copyText(($("#link") as HTMLInputElement).value, $("#copy-link")));
  // Native share (Web Share API), great on mobile. Shown only where supported;
  // elsewhere the copy button stays the primary affordance.
  const shareBtn = $("#share-link") as HTMLButtonElement | null;
  if (shareBtn && typeof navigator.share === "function") {
    show(shareBtn, true);
    shareBtn.addEventListener("click", () => void shareLink());
  }
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
  setupPrefs();
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

// A poof button is a small interactive scene on a canvas: a drifting glyph field
// at rest, a mono label that loops an idle label <-> a bash command via an ascii
// scramble (no hover; works on touch), and on submit an ascii smoke ring that
// sweeps the whole button while the request is in flight. Shared by the create
// button ("create poof" / "$ poof") and the reveal button ("reveal poof" /
// "$ poof get"), so both get the same poof animation.
function setupPoofButton(
  selector: string,
  idleText: string,
  cmdText: string,
): { startRing: () => void; stopRing: () => void; startIdle: () => void } | null {
  const btn = document.querySelector(selector) as HTMLButtonElement | null;
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

  const LABEL = idleText;
  const CMD = cmdText;
  // Render a leading "$" of the command in green; the rest stays plain. Lets the
  // reveal command ("$ poof get") get the same prompt treatment as create.
  const cmdHtml = CMD.startsWith("$") ? '<span class="pr">$</span>' + CMD.slice(1) : CMD;
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
  const toCmd = () => scramble(LABEL, CMD, 300, () => { settle(cmdHtml); timer = window.setTimeout(toLabel, 1300); });
  const toLabel = () => scramble(CMD, LABEL, 300, () => { settle(LABEL); timer = window.setTimeout(toCmd, 3000); });

  function startIdle() {
    cancelAnimationFrame(ringRaf);
    label.style.visibility = "visible";
    settle(LABEL);
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

  // Validate the optional PIN/password up front (ADR-0004, variable length) so
  // an invalid value surfaces immediately instead of being silently dropped.
  const pinRaw = ($("#pin") as HTMLInputElement).value.trim();
  if (pinRaw && !isValidPin(pinRaw)) {
    $("#create-error").textContent = `PIN or password must be ${PIN_MIN_LEN} to ${PIN_MAX_LEN} characters`;
    show($("#create-error"), true);
    return;
  }
  const pin = pinRaw || undefined;

  // TTL and reveal budget: each control is a preset OR "custom" (#22). A custom
  // TTL is a number times a unit; a custom reveal count is a positive integer.
  // Both are clamped to the shared bounds (the Worker re-clamps as the authority).
  const ttlSel = $("#ttl") as HTMLSelectElement;
  const budgetSel = $("#budget") as HTMLSelectElement;
  let ttlMs: number;
  if (ttlSel.value === "custom") {
    const n = Number(($("#ttl-num") as HTMLInputElement).value);
    if (!Number.isFinite(n) || n < 1) {
      $("#create-error").textContent = "enter a custom expiry (a positive number).";
      show($("#create-error"), true);
      return;
    }
    ttlMs = clampTtlMs(n * Number(($("#ttl-unit") as HTMLSelectElement).value));
  } else {
    ttlMs = clampTtlMs(Number(ttlSel.value));
  }
  let revealBudget: number;
  if (budgetSel.value === "custom") {
    const n = Number(($("#budget-num") as HTMLInputElement).value);
    if (!Number.isFinite(n) || n < 1) {
      $("#create-error").textContent = "enter a custom reveal count (a positive number).";
      show($("#create-error"), true);
      return;
    }
    revealBudget = clampRevealBudget(n);
  } else {
    revealBudget = clampRevealBudget(Number(budgetSel.value));
  }

  // Creator's show/hide-countdown choice (ADR-0014), default on.
  const showCountdown = ($("#show-countdown") as HTMLInputElement | null)?.checked ?? true;
  // Creator's opt-in to require a captcha on reveal (ADR-0015), default off. When
  // off, the poof stays revealable by an agent / the machine path.
  const requireTurnstile = ($("#require-turnstile") as HTMLInputElement | null)?.checked ?? false;

  btn.disabled = true;
  show($("#create-error"), false);
  btnCtl?.startRing();
  // Always let the poof sweep at least once, even if the request is instant.
  const minPoof = new Promise<void>((r) => setTimeout(r, 560));
  try {
    const master = generateMasterKey();
    const id = generateClipId();

    // Stamp the expiry deadline into the encrypted metadata (ADR-0014) so the
    // recipient can render a private countdown; the server never sees it. The
    // creator's show/hide-countdown choice rides along (default on, so the
    // flag is only written when off, keeping the metadata minimal).
    const meta: ClipMeta = { ...pending.meta, expiresAt: Date.now() + ttlMs };
    if (!showCountdown) meta.showCountdown = false;
    const metaCipher = await encryptBlob(master, id, "metadata", te.encode(JSON.stringify(meta)));
    const contentCipher = await encryptBlob(master, id, "content", pending.bytes, pin);

    const fd = new FormData();
    fd.set("id", id);
    fd.set("turnstile", turnstileToken());
    fd.set("ttlMs", String(ttlMs));
    fd.set("revealBudget", String(revealBudget));
    if (pin) fd.set("pin", pin);
    if (requireTurnstile) fd.set("requireTurnstile", "1");
    fd.set("meta", new Blob([metaCipher]));
    fd.set("content", new Blob([contentCipher]));

    const res = await fetch("/api/clip", { method: "POST", body: fd });
    if (!res.ok) {
      if (res.status === 413) {
        const body = (await res.json().catch(() => ({}))) as { maxBytes?: number };
        const max = typeof body.maxBytes === "number" ? body.maxBytes : MAX_CLIP_BYTES;
        throw new Error(`that's too big. Max is ${formatBytes(max)} per poof.`);
      }
      throw new Error(`create failed (${res.status})`);
    }
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
    $("#create-error").textContent = err instanceof Error ? err.message : String(err);
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

let countdownTimer = 0;

// Recipient countdown + best-effort auto-clear (ADR-0014). Driven by the
// expiresAt carried in the decrypted metadata (never a cleartext field). The
// bar is shown only when the creator left the countdown on, but the auto-clear
// timer always runs when we know the deadline: an open page clears its revealed
// content when the poof burns. Best-effort, not a confidentiality control: an
// already-revealed poof may have been copied or screenshotted.
function startCountdown(id: string, expiresAt: number, showBar: boolean) {
  const openedAt = Date.now();
  const box = $("#countdown");
  const fill = $(".cd-fill") as HTMLElement;
  const text = $(".cd-text");
  if (showBar) show(box, true);
  let busy = false;
  let done = false;
  const expire = () => {
    if (done) return;
    done = true;
    clearInterval(countdownTimer);
    // Drop the decrypted bytes and tear down the revealed sandbox iframe.
    sessionCache.delete(id);
    const host = $("#content");
    if (host) host.innerHTML = "";
    show(box, false);
    showGone();
  };
  const tick = () => {
    if (done) return;
    const now = Date.now();
    const left = expiresAt - now;
    if (showBar) {
      fill.style.width = (countdownFraction(now, openedAt, expiresAt) * 100).toFixed(2) + "%";
      text.textContent = left > 0 ? formatRemaining(left) + " left" : "expiring...";
    }
    if (left <= 0 && !busy) {
      busy = true;
      // Skew-tolerant: confirm the server actually burned it (non-consuming)
      // before clearing, so a fast client clock cannot clear early.
      void fetch(`/api/clip/${id}/meta`)
        .then(async (r) => {
          const gone = r.status === 404 || !((await r.json().catch(() => ({}))) as { exists?: boolean }).exists;
          if (gone) expire();
          else busy = false;
        })
        .catch(() => {
          busy = false;
        });
    }
  };
  countdownTimer = window.setInterval(tick, 500);
  tick();
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
    turnstileRequired?: boolean;
  };
  if (!data.exists) return showGone();
  const turnstileRequired = data.turnstileRequired === true;

  let meta: ClipMeta;
  try {
    const bytes = await decryptBlob(master, id, "metadata", base64urlDecode(data.metadata));
    meta = JSON.parse(td.decode(bytes)) as ClipMeta;
  } catch {
    $("#pc-detail").textContent = "could not decrypt (bad link)";
    show($("#reveal-btn"), false);
    show($("#precard"), true);
    return;
  }

  $("#pc-kind").textContent = meta.kind;
  $("#pc-detail").textContent = (meta.filename ? `${meta.filename} · ` : "") + formatSize(meta.size);
  $("#pc-reveals").textContent =
    data.revealsRemaining === null ? "unlimited reveals" : `${data.revealsRemaining} reveal(s) left`;
  if (data.pinRequired) show($("#pin-entry"), true);
  // Turnstile on reveal is now an independent, opt-in gate (ADR-0015), no longer
  // implied by a PIN. Show the widget only when this poof actually requires it.
  if (turnstileRequired) show($("#reveal-ts-wrap"), true);
  show($("#precard"), true);

  // Countdown + best-effort auto-clear once we know the (encrypted) deadline.
  if (typeof meta.expiresAt === "number") {
    startCountdown(id, meta.expiresAt, meta.showCountdown !== false);
  }

  // Set up the reveal poof-button now that the precard is laid out, so its canvas
  // measures the real button box. Same animation as create ("$ poof get").
  revealCtl = setupPoofButton("#reveal-btn", "reveal poof", "$ poof get");
  $("#reveal-btn").addEventListener("click", () =>
    void doReveal(id, master, meta, data.pinRequired, turnstileRequired),
  );
}

async function doReveal(
  id: string,
  master: Uint8Array,
  meta: ClipMeta,
  pinRequired: boolean,
  turnstileRequired: boolean,
) {
  const btn = $("#reveal-btn") as HTMLButtonElement;
  if (btn.disabled) return;
  show($("#precard-info"), false);

  // Validate inputs BEFORE the poof animation so an input error never flashes
  // the ring. PIN and Turnstile are independent now (ADR-0015).
  let pin: string | undefined;
  if (pinRequired) {
    pin = ($("#reveal-pin") as HTMLInputElement).value.trim();
    if (!isValidPin(pin)) {
      $("#precard-info").textContent = "enter the PIN or password for this poof";
      show($("#precard-info"), true);
      return;
    }
  }
  const turnstile = turnstileRequired ? turnstileToken() : undefined;

  btn.disabled = true;
  revealCtl?.startRing();
  // Let the poof sweep at least once before the content materializes.
  const minPoof = new Promise<void>((r) => setTimeout(r, 560));

  // Recoverable failure: stop the ring, restore the idle button, surface a note.
  const recover = (msg: string) => {
    revealCtl?.stopRing();
    revealCtl?.startIdle();
    btn.disabled = false;
    $("#precard-info").textContent = msg;
    show($("#precard-info"), true);
  };

  try {
    let bytes = sessionCache.get(id);
    if (!bytes) {
      const hasBody = pinRequired || turnstileRequired;
      const init: RequestInit = hasBody
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin, turnstile }) }
        : { method: "POST" };
      const res = await fetch(`/api/clip/${id}/reveal`, init);
      if (res.status === 410) {
        revealCtl?.stopRing();
        return showGone();
      }
      if (res.status === 423) return recover("too many wrong PINs. This poof is locked until it expires.");
      if (res.status === 403) return recover("this poof needs a captcha. Complete it and try again.");
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { attemptsLeft?: number };
        return recover(
          body.attemptsLeft != null ? `wrong PIN. ${body.attemptsLeft} attempt(s) left.` : "PIN required.",
        );
      }
      if (!res.ok) return recover("reveal failed");
      const cipher = new Uint8Array(await res.arrayBuffer());
      bytes = await decryptBlob(master, id, "content", cipher, pin);
      sessionCache.set(id, bytes);
    }
    await minPoof;
    revealCtl?.stopRing();
    renderContent(bytes, meta);
    show($("#precard"), false);
    // Add the entrance class while still hidden, then unhide, so the animation
    // starts cleanly from display:none -> block (no first-frame flash). Without
    // a fill-mode the base opacity (1) governs if the animation never runs.
    const revealed = $("#revealed");
    revealed.classList.add("materialize");
    show(revealed, true);
  } catch {
    recover("decryption failed");
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
  } else if (decision.mode === "video" || decision.mode === "audio") {
    // Inline playback in the opaque-origin sandbox (blob URL, ADR-0012). No
    // corner copy icon (copying raw media bytes is not useful); offer a download.
    mountSandbox(host, buildSandboxMessage(decision, bytes));
    actions.appendChild(
      actionButton("download", () =>
        download(bytes, meta.filename ?? decision.mode, meta.mime ?? "application/octet-stream"),
      ),
    );
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
