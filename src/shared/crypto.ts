// Zero-knowledge crypto for Poof. See ADR-0001, ADR-0004, ADR-0009.
// Pure module: uses only the Web Crypto API (crypto.subtle), available in the
// browser, in workerd, and in Node 20+. No third-party crypto.

const enc = new TextEncoder();

// TS 5.7+ types a plain Uint8Array as Uint8Array<ArrayBufferLike>, which the DOM
// lib's BufferSource rejects (ArrayBufferLike includes SharedArrayBuffer). Our
// byte arrays are always ArrayBuffer-backed at runtime, so we pass them through
// as BufferSource. Type-only; no runtime behavior change.
const buf = (u: Uint8Array): BufferSource => u as BufferSource;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The Fragment Key is 32 random bytes (ADR-0009).
export function generateMasterKey(): Uint8Array {
  return randomBytes(32);
}

// Unguessable routing id, distinct from any key (ADR-0009).
export function generateClipId(): string {
  return base64urlEncode(randomBytes(16));
}

// High-entropy owner token, never carried in the Link (ADR-0008).
export function generateOwnerToken(): string {
  return base64urlEncode(randomBytes(32));
}

export const encodeKey = base64urlEncode;
export const decodeKey = base64urlDecode;

export type BlobRole = "metadata" | "content";

// HKDF info strings, one per role (ADR-0009). Exported so the published wire
// format (src/shared/wire.ts) is sourced from the same constants the derivation
// uses, and cannot drift from it.
export const METADATA_INFO = "poof/metadata/v1";
export const CONTENT_INFO = "poof/content/v1";

// HKDF-SHA-256 key hierarchy (ADR-0009). The PIN is folded into the input key
// material for the content role only, so the metadata key is independent of it.
async function deriveAesKey(
  master: Uint8Array,
  clipId: string,
  role: BlobRole,
  pin?: string,
): Promise<CryptoKey> {
  let ikm: Uint8Array = master;
  if (role === "content" && pin) {
    const pinBytes = enc.encode(pin);
    ikm = new Uint8Array(master.length + pinBytes.length);
    ikm.set(master, 0);
    ikm.set(pinBytes, master.length);
  }
  const baseKey = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveKey"]);
  const info = enc.encode(role === "metadata" ? METADATA_INFO : CONTENT_INFO);
  const salt = enc.encode(clipId);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Returns IV (12 bytes) prepended to the AES-GCM ciphertext.
export async function encryptBlob(
  master: Uint8Array,
  clipId: string,
  role: BlobRole,
  plaintext: Uint8Array,
  pin?: string,
): Promise<Uint8Array> {
  const key = await deriveAesKey(master, clipId, role, pin);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

// Throws on authentication failure (wrong key or wrong PIN).
export async function decryptBlob(
  master: Uint8Array,
  clipId: string,
  role: BlobRole,
  blob: Uint8Array,
  pin?: string,
): Promise<Uint8Array> {
  const key = await deriveAesKey(master, clipId, role, pin);
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(ct)));
}
