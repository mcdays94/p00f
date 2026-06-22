// Ciphertext-only protocol client (ADR-0010). Every function takes an injected
// fetch (HttpLike) plus a baseUrl, and sends only ciphertext, ids, and policy.
// The Fragment Key is NEVER passed to anything in this module, so no shell built
// on it can leak the key to the server.
import { base64urlDecode } from "./crypto";
import { MAX_CLIP_BYTES, formatBytes } from "./limits";

export type HttpLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MetaResponse {
  exists: boolean;
  metadata?: Uint8Array; // decoded ciphertext of the metadata blob
  revealsRemaining: number | null;
  pinRequired: boolean;
  turnstileRequired: boolean;
  allowViewerDelete: boolean;
  size?: number;
}

export interface CreateCiphertext {
  id: string;
  metaCipher: Uint8Array;
  contentCipher: Uint8Array;
  ttlMs?: number;
  revealBudget?: number;
  pin?: string;
  requireTurnstile?: boolean;
  allowViewerDelete?: boolean;
  turnstile?: string;
}

export type RevealOutcome =
  | { ok: true; content: Uint8Array }
  | { ok: false; reason: "gone" | "locked" | "pin" | "turnstile"; status: number; attemptsLeft?: number };

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function createClip(
  http: HttpLike,
  baseUrl: string,
  c: CreateCiphertext,
): Promise<{ id: string; ownerToken: string }> {
  const fd = new FormData();
  fd.set("id", c.id);
  // Machine path sends no Turnstile token; the server allows it under the floor
  // (ADR-0011). A browser shell passes a real token to rise above the floor.
  if (c.turnstile) fd.set("turnstile", c.turnstile);
  if (c.ttlMs != null) fd.set("ttlMs", String(c.ttlMs));
  if (c.revealBudget != null) fd.set("revealBudget", String(c.revealBudget));
  if (c.pin) fd.set("pin", c.pin);
  if (c.requireTurnstile) fd.set("requireTurnstile", "1");
  if (c.allowViewerDelete) fd.set("allowViewerDelete", "1");
  // metaCipher/contentCipher are Uint8Array<ArrayBufferLike>; cast to BlobPart
  // (the DOM lib wants an ArrayBuffer-backed view). Type-only; no runtime change.
  fd.set("meta", new Blob([c.metaCipher as BlobPart]));
  fd.set("content", new Blob([c.contentCipher as BlobPart]));
  const res = await http(`${trimBase(baseUrl)}/api/clip`, { method: "POST", body: fd });
  if (!res.ok) {
    if (res.status === 413) {
      const body = (await res.json().catch(() => ({}))) as { maxBytes?: number };
      const max = typeof body.maxBytes === "number" ? body.maxBytes : MAX_CLIP_BYTES;
      throw new Error(`too large to create (max ${formatBytes(max)} per poof)`);
    }
    throw new Error(`create failed (${res.status})`);
  }
  return (await res.json()) as { id: string; ownerToken: string };
}

export async function getMeta(http: HttpLike, baseUrl: string, id: string): Promise<MetaResponse> {
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/meta`);
  if (res.status === 404)
    return { exists: false, revealsRemaining: null, pinRequired: false, turnstileRequired: false, allowViewerDelete: false };
  if (!res.ok) throw new Error(`meta failed (${res.status})`);
  const j = (await res.json()) as {
    exists: boolean;
    metadata: string;
    revealsRemaining: number | null;
    pinRequired: boolean;
    turnstileRequired?: boolean;
    allowViewerDelete?: boolean;
    size: number;
  };
  return {
    exists: j.exists,
    metadata: j.metadata ? base64urlDecode(j.metadata) : undefined,
    revealsRemaining: j.revealsRemaining,
    pinRequired: j.pinRequired,
    turnstileRequired: j.turnstileRequired ?? false,
    allowViewerDelete: j.allowViewerDelete ?? false,
    size: j.size,
  };
}

export async function revealClip(
  http: HttpLike,
  baseUrl: string,
  id: string,
  opts?: { pin?: string; turnstile?: string },
): Promise<RevealOutcome> {
  // Only send a JSON body when there is something to send. Crucially, the machine
  // path no longer fabricates a "tok" Turnstile token (ADR-0015): a poof that
  // does not require Turnstile reveals with no token, so an agent can reveal it
  // (and a PIN poof reveals with just the PIN). A real token is sent only when
  // the caller supplies one for a turnstileRequired poof.
  const init: RequestInit = { method: "POST" };
  if (opts?.pin || opts?.turnstile) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify({ pin: opts?.pin, turnstile: opts?.turnstile });
  }
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/reveal`, init);
  if (res.ok) return { ok: true, content: new Uint8Array(await res.arrayBuffer()) };
  if (res.status === 410) return { ok: false, reason: "gone", status: 410 };
  if (res.status === 423) return { ok: false, reason: "locked", status: 423 };
  if (res.status === 403) return { ok: false, reason: "turnstile", status: 403 };
  const body = (await res.json().catch(() => ({}))) as { attemptsLeft?: number };
  return { ok: false, reason: "pin", status: res.status, attemptsLeft: body.attemptsLeft };
}

export async function deleteClip(
  http: HttpLike,
  baseUrl: string,
  id: string,
  ownerToken: string,
): Promise<{ ok: boolean }> {
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerToken }),
  });
  return { ok: res.ok };
}

// Viewer-initiated burn (ADR-0016): no owner token. Only succeeds when the
// creator set allowViewerDelete; the server returns 403 otherwise. A 200 (incl.
// the "already gone" case) is treated as success, since the destroy intent is
// then satisfied, mirroring the owner deleteClip path.
export async function burnAsViewer(
  http: HttpLike,
  baseUrl: string,
  id: string,
): Promise<{ ok: boolean; reason?: "forbidden" }> {
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/burn`, { method: "POST" });
  if (res.ok) return { ok: true };
  if (res.status === 403) return { ok: false, reason: "forbidden" };
  return { ok: false };
}
