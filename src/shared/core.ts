// @p00f/core: the single zero-knowledge engine (ADR-0010). One implementation of
// crypto + Link + protocol, consumed by the web app, the CLI, and the MCP server.
// Web Crypto only, so it runs in the browser, in Node 20+, and in workerd.
export * from "./crypto";
export * from "./link";
export * from "./protocol";

import { generateMasterKey, generateClipId, encryptBlob, decryptBlob } from "./crypto";
import { buildLink, parseLink } from "./link";
import { createClip, getMeta, revealClip, deleteClip, type HttpLike } from "./protocol";

const te = new TextEncoder();
const td = new TextDecoder();

// kind is an arbitrary string, stored inside the encrypted metadata blob, so the
// server never learns it (ADR-0003, POOF-14).
export interface ClipMeta {
  kind: string;
  filename?: string;
  mime?: string;
  size: number;
  // Expiry deadline (epoch ms) lives in the ENCRYPTED metadata so only a
  // Fragment-Key holder can read it (ADR-0014). The server keeps its own
  // authoritative expiry to run the Burn but no longer publishes it.
  expiresAt?: number;
  // Creator preference: show the recipient a countdown (default on). UI-level
  // only, since the revealer holds the key.
  showCountdown?: boolean;
}

export interface CreateInput {
  content: Uint8Array;
  meta: ClipMeta;
  ttlMs?: number;
  revealBudget?: number;
  pin?: string;
  turnstile?: string;
}

export interface CreatedClip {
  link: string;
  id: string;
  ownerToken: string;
}

export async function create(http: HttpLike, baseUrl: string, input: CreateInput): Promise<CreatedClip> {
  const master = generateMasterKey();
  const id = generateClipId();
  // Stamp the expiry deadline into the encrypted metadata (ADR-0014) so the
  // recipient can render a private countdown. Default mirrors the server's TTL.
  const ttlMs = input.ttlMs ?? 5 * 60_000;
  const meta: ClipMeta = { ...input.meta, expiresAt: input.meta.expiresAt ?? Date.now() + ttlMs };
  const metaCipher = await encryptBlob(master, id, "metadata", te.encode(JSON.stringify(meta)));
  const contentCipher = await encryptBlob(master, id, "content", input.content, input.pin);
  const { id: serverId, ownerToken } = await createClip(http, baseUrl, {
    id,
    metaCipher,
    contentCipher,
    ttlMs: input.ttlMs,
    revealBudget: input.revealBudget,
    pin: input.pin,
    turnstile: input.turnstile,
  });
  return { link: buildLink({ origin: baseUrl, id: serverId, key: master }), id: serverId, ownerToken };
}

export interface ClipInfo {
  exists: boolean;
  meta?: ClipMeta;
  revealsRemaining: number | null;
  pinRequired: boolean;
  expiresAt?: number;
}

// Non-consuming: fetches and decrypts the metadata blob only (ADR-0003).
export async function info(http: HttpLike, link: string): Promise<ClipInfo> {
  const { origin, id, key } = parseLink(link);
  const m = await getMeta(http, origin, id);
  if (!m.exists || !m.metadata) return { exists: false, revealsRemaining: null, pinRequired: false };
  let meta: ClipMeta | undefined;
  try {
    meta = JSON.parse(td.decode(await decryptBlob(key, id, "metadata", m.metadata))) as ClipMeta;
  } catch {
    meta = undefined;
  }
  return {
    exists: true,
    meta,
    revealsRemaining: m.revealsRemaining,
    pinRequired: m.pinRequired,
    // Expiry now comes from the decrypted metadata, not a cleartext field (ADR-0014).
    expiresAt: meta?.expiresAt,
  };
}

export interface ReadResult {
  ok: boolean;
  reason?: "gone" | "locked" | "pin" | "decrypt";
  meta?: ClipMeta;
  content?: Uint8Array;
  attemptsLeft?: number;
}

// Consuming: reveals and decrypts content (ADR-0002). Fetches metadata first
// (non-consuming) so the caller learns kind/filename; tolerates meta failure.
export async function read(
  http: HttpLike,
  link: string,
  opts?: { pin?: string; turnstile?: string },
): Promise<ReadResult> {
  const { origin, id, key } = parseLink(link);
  let meta: ClipMeta | undefined;
  try {
    const m = await getMeta(http, origin, id);
    if (m.exists && m.metadata) {
      meta = JSON.parse(td.decode(await decryptBlob(key, id, "metadata", m.metadata))) as ClipMeta;
    }
  } catch {
    // ignore metadata errors; the reveal call below is the source of truth
  }
  const r = await revealClip(http, origin, id, opts);
  if (!r.ok) return { ok: false, reason: r.reason, attemptsLeft: r.attemptsLeft, meta };
  let content: Uint8Array;
  try {
    content = await decryptBlob(key, id, "content", r.content, opts?.pin);
  } catch {
    return { ok: false, reason: "decrypt", meta };
  }
  return { ok: true, content, meta };
}

export async function burn(
  http: HttpLike,
  linkOrId: string,
  ownerToken: string,
  baseUrl?: string,
): Promise<{ ok: boolean }> {
  let origin: string;
  let id: string;
  try {
    const p = parseLink(linkOrId);
    origin = p.origin;
    id = p.id;
  } catch {
    if (!baseUrl) throw new Error("burn needs a full Link, or an id plus baseUrl");
    origin = baseUrl;
    id = linkOrId;
  }
  return deleteClip(http, origin, id, ownerToken);
}
