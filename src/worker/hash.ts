// Server-side hashing for access-control credentials (ADR-0004, ADR-0008).
// The PIN gate uses a slow salted hash (low-entropy secret); the owner token
// uses a salted SHA-256 (high-entropy secret). Neither is the decryption key.
import { randomBytes, base64urlEncode, base64urlDecode } from "../shared/crypto";

const te = new TextEncoder();

export function randomSaltB64(): string {
  return base64urlEncode(randomBytes(16));
}

export async function pbkdf2B64(secret: string, saltB64: string, iters: number): Promise<string> {
  const km = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64urlDecode(saltB64), iterations: iters, hash: "SHA-256" },
    km,
    256,
  );
  return base64urlEncode(new Uint8Array(bits));
}

export async function sha256B64(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", te.encode(input));
  return base64urlEncode(new Uint8Array(d));
}
