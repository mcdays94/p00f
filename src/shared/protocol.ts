// Ciphertext-only protocol client (ADR-0010). Every function takes an injected
// fetch (HttpLike) plus a baseUrl, and sends only ciphertext, ids, and policy.
// The Fragment Key is NEVER passed to anything in this module, so no shell built
// on it can leak the key to the server.
import { base64urlDecode } from "./crypto";

export type HttpLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MetaResponse {
  exists: boolean;
  metadata?: Uint8Array; // decoded ciphertext of the metadata blob
  revealsRemaining: number | null;
  expiresAt?: number;
  pinRequired: boolean;
  size?: number;
}

export interface CreateCiphertext {
  id: string;
  metaCipher: Uint8Array;
  contentCipher: Uint8Array;
  ttlMs?: number;
  revealBudget?: number;
  pin?: string;
  turnstile?: string;
}

export type RevealOutcome =
  | { ok: true; content: Uint8Array }
  | { ok: false; reason: "gone" | "locked" | "pin"; status: number; attemptsLeft?: number };

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
  fd.set("turnstile", c.turnstile ?? "tok");
  if (c.ttlMs != null) fd.set("ttlMs", String(c.ttlMs));
  if (c.revealBudget != null) fd.set("revealBudget", String(c.revealBudget));
  if (c.pin) fd.set("pin", c.pin);
  fd.set("meta", new Blob([c.metaCipher]));
  fd.set("content", new Blob([c.contentCipher]));
  const res = await http(`${trimBase(baseUrl)}/api/clip`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`create failed (${res.status})`);
  return (await res.json()) as { id: string; ownerToken: string };
}

export async function getMeta(http: HttpLike, baseUrl: string, id: string): Promise<MetaResponse> {
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/meta`);
  if (res.status === 404) return { exists: false, revealsRemaining: null, pinRequired: false };
  if (!res.ok) throw new Error(`meta failed (${res.status})`);
  const j = (await res.json()) as {
    exists: boolean;
    metadata: string;
    revealsRemaining: number | null;
    expiresAt: number;
    pinRequired: boolean;
    size: number;
  };
  return {
    exists: j.exists,
    metadata: j.metadata ? base64urlDecode(j.metadata) : undefined,
    revealsRemaining: j.revealsRemaining,
    expiresAt: j.expiresAt,
    pinRequired: j.pinRequired,
    size: j.size,
  };
}

export async function revealClip(
  http: HttpLike,
  baseUrl: string,
  id: string,
  opts?: { pin?: string; turnstile?: string },
): Promise<RevealOutcome> {
  const init: RequestInit = { method: "POST" };
  if (opts?.pin) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify({ pin: opts.pin, turnstile: opts.turnstile ?? "tok" });
  }
  const res = await http(`${trimBase(baseUrl)}/api/clip/${id}/reveal`, init);
  if (res.ok) return { ok: true, content: new Uint8Array(await res.arrayBuffer()) };
  if (res.status === 410) return { ok: false, reason: "gone", status: 410 };
  if (res.status === 423) return { ok: false, reason: "locked", status: 423 };
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
