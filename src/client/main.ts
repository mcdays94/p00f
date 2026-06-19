import {
  generateMasterKey,
  generateClipId,
  encodeKey,
  decodeKey,
  encryptBlob,
  decryptBlob,
  base64urlDecode,
} from "../shared/crypto";

const te = new TextEncoder();
const td = new TextDecoder();

type Kind = "text" | "code" | "image" | "file";
interface ClipMeta {
  kind: Kind;
  filename?: string;
  mime?: string;
  size: number;
}

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

async function loadFile(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const kind: Kind = f.type.startsWith("image/") ? "image" : "file";
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

  ta.addEventListener("input", () => {
    const v = ta.value;
    if (!v) return clearPending();
    const bytes = te.encode(v);
    setPending(bytes, { kind: looksLikeCode(v) ? "code" : "text", mime: "text/plain", size: bytes.length });
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
    const metaCipher = await encryptBlob(master, id, "metadata", te.encode(JSON.stringify(pending.meta)));
    const contentCipher = await encryptBlob(master, id, "content", pending.bytes);

    const fd = new FormData();
    fd.set("id", id);
    fd.set("turnstile", turnstileToken());
    fd.set("ttlMs", ($("#ttl") as HTMLSelectElement).value);
    fd.set("revealBudget", ($("#budget") as HTMLSelectElement).value);
    fd.set("meta", new Blob([metaCipher]));
    fd.set("content", new Blob([contentCipher]));

    const res = await fetch("/api/clip", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`create failed (${res.status})`);
    const { id: serverId } = (await res.json()) as { id: string };

    const link = `${location.origin}/c/${serverId}#${encodeKey(master)}`;
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
  show($("#precard"), true);

  $("#reveal-btn").addEventListener("click", () => void doReveal(id, master, meta));
}

async function doReveal(id: string, master: Uint8Array, meta: ClipMeta) {
  const btn = $("#reveal-btn") as HTMLButtonElement;
  btn.disabled = true;
  try {
    let bytes = sessionCache.get(id);
    if (!bytes) {
      const res = await fetch(`/api/clip/${id}/reveal`, { method: "POST" });
      if (res.status === 410) return showGone();
      if (!res.ok) {
        $("#precard-info").textContent = "reveal failed";
        show($("#precard-info"), true);
        return;
      }
      const cipher = new Uint8Array(await res.arrayBuffer());
      bytes = await decryptBlob(master, id, "content", cipher);
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

function download(bytes: Uint8Array, meta: ClipMeta) {
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.mime ?? "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.filename ?? "clip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function renderContent(bytes: Uint8Array, meta: ClipMeta) {
  const host = $("#content");
  host.innerHTML = "";
  const actions = document.createElement("div");
  actions.className = "actions";

  if (meta.kind === "image") {
    const url = URL.createObjectURL(new Blob([bytes], { type: meta.mime ?? "image/*" }));
    const img = document.createElement("img");
    img.className = "clip-img";
    img.src = url;
    host.appendChild(img);
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
    actions.appendChild(actionButton("download", () => download(bytes, meta)));
  } else if (meta.kind === "file") {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `${meta.filename ?? "file"} · ${formatSize(meta.size)}`;
    host.appendChild(p);
    actions.appendChild(actionButton("download", () => download(bytes, meta)));
  } else {
    const text = td.decode(bytes);
    const pre = document.createElement("pre");
    pre.className = "clip-pre";
    const code = document.createElement("code");
    code.textContent = text;
    pre.appendChild(code);
    host.appendChild(pre);
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
