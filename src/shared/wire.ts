// Published wire-format contract (PRD 0002, ADR-0010). This module owns the
// machine-readable description of how a p00f Link is encrypted and addressed,
// so a non-SDK caller can implement decryption. @p00f/core is the reference
// implementation. Pure: string and object building only, no crypto.subtle.
import { base64urlEncode, METADATA_INFO, CONTENT_INFO } from "./crypto";

// Coarse size class for the cleartext envelope. The exact byte length lives only
// inside the encrypted metadata blob; the cleartext envelope publishes a bucket
// so an agent can gauge scale without the server (or an envelope scraper)
// learning the precise content-length (ADR-0003 residual-leak mitigation).
export function sizeBucket(n: number): string {
  if (n < 1024) return "tiny"; // < 1 KiB
  if (n < 102_400) return "small"; // < 100 KiB
  if (n < 1_048_576) return "medium"; // < 1 MiB
  return "large"; // >= 1 MiB
}

// The .json envelope: cleartext protocol fields the server already enforces,
// plus the encrypted metadata blob (base64url ciphertext). It never contains
// plaintext, the Fragment Key, or the exact kind/filename/size in cleartext.
export interface Envelope {
  id: string;
  revealsRemaining: number | null; // null = unlimited until expiry
  pinRequired: boolean;
  hasContent: boolean;
  sizeBucket: string;
  metadata: string; // base64url AES-GCM ciphertext (12-byte IV prepended)
}

export function buildEnvelope(input: {
  id: string;
  revealsRemaining: number | null;
  pinRequired: boolean;
  size: number;
  metadata: Uint8Array;
}): Envelope {
  return {
    id: input.id,
    revealsRemaining: input.revealsRemaining,
    pinRequired: input.pinRequired,
    hasContent: true,
    sizeBucket: sizeBucket(input.size),
    metadata: base64urlEncode(input.metadata),
  };
}

// The structured wire-format contract, embedded in the discovery document and
// rendered as prose in llms.txt. Sourced from the same constants the crypto
// derivation uses, so it cannot drift.
export const WIRE_FORMAT = {
  key: "32 random bytes, base64url, carried only in the URL fragment after '#'. The fragment is never sent to the server.",
  id: "16 random bytes, base64url. The routing id, distinct from the key.",
  base64url: "RFC 4648 base64url: '-' and '_' alphabet, padding stripped.",
  kdf: {
    algorithm: "HKDF-SHA-256",
    salt: "the clip id, UTF-8 bytes",
    info: { metadata: METADATA_INFO, content: CONTENT_INFO },
    pin: "for the content role only, an optional PIN or password (variable length, 4 to 128 chars) is appended to the master key bytes to form the IKM (master || pin); the metadata key is independent of the PIN.",
  },
  cipher: {
    algorithm: "AES-GCM-256",
    nonce: "12 random bytes (IV), prepended to the ciphertext: layout is iv(12) || ciphertext+tag.",
  },
  envelope: {
    cleartext: ["id", "revealsRemaining", "pinRequired", "hasContent", "sizeBucket"],
    encrypted: "metadata: base64url AES-GCM ciphertext of the JSON { kind, filename, mime, size, expiresAt, showCountdown }",
    note: "The exact kind, filename, mime, size, and the expiry deadline (expiresAt) are inside the encrypted metadata blob, never in cleartext (ADR-0014).",
  },
} as const;

export interface DiscoveryDoc {
  name: string;
  brand: string;
  description: string;
  zeroKnowledge: string;
  endpoints: Record<string, string>;
  wireFormat: typeof WIRE_FORMAT;
  reference: string;
}

export function discoveryDoc(origin: string): DiscoveryDoc {
  const o = origin.replace(/\/+$/, "");
  return {
    name: "poof",
    brand: "p00f",
    description:
      "Zero-knowledge, ephemeral clipboard. Humans and agents exchange transient context, secrets, and intermediate results by URL. The hosted API only ever holds ciphertext.",
    zeroKnowledge:
      "All encryption and decryption happen caller-side. The Fragment Key lives in the URL fragment and never reaches the server. The server cannot read content and cannot recover a lost link.",
    endpoints: {
      create: `POST ${o}/api/clip (multipart: meta, content ciphertext blobs, ttlMs, revealBudget, optional pin, optional id). No Turnstile token is required on the machine path; it is allowed under a rate-limit floor.`,
      envelope: `GET ${o}/c/:id.json (or GET ${o}/c/:id with Accept: application/json). Non-consuming. Returns the encrypted metadata envelope.`,
      reveal: `POST ${o}/api/clip/:id/reveal. Consuming. Returns the encrypted content as application/octet-stream; decrypt caller-side.`,
      meta: `GET ${o}/api/clip/:id/meta. Non-consuming legacy metadata endpoint.`,
      delete: `POST ${o}/api/clip/:id/delete (body: { ownerToken }). Owner-gated early burn.`,
      health: `GET ${o}/health`,
    },
    wireFormat: WIRE_FORMAT,
    reference: "@p00f/core is the supported reference implementation of this wire format.",
  };
}

export function llmsTxt(origin: string): string {
  const o = origin.replace(/\/+$/, "");
  const w = WIRE_FORMAT;
  return `# p00f

Zero-knowledge, ephemeral clipboard for humans and agents. Exchange transient
context, secrets, prompts, and intermediate results by URL. The hosted API only
ever holds ciphertext; all encryption and decryption happen caller-side.

## Trust model

The Fragment Key is ${w.key}
The server cannot read content and cannot recover a lost link. Whoever holds the
link (and any LLM behind them) can decrypt and will see plaintext.

## Endpoints

- POST ${o}/api/clip
  Create. Multipart form: meta and content ciphertext blobs, ttlMs, revealBudget,
  optional pin, optional id. No Turnstile token is required on the machine path;
  anonymous create is allowed under an identity-free rate-limit floor.
- GET ${o}/c/:id.json  (or GET ${o}/c/:id with Accept: application/json)
  Non-consuming. Returns the encrypted metadata envelope (see below).
- POST ${o}/api/clip/:id/reveal
  Consuming. Returns encrypted content as application/octet-stream. Decrypt
  caller-side. Reveal is a POST so prefetchers and unfurlers never spend budget.
- POST ${o}/api/clip/:id/delete  body { ownerToken }
  Owner-gated early burn. The owner token is returned once at create and is
  never carried in the link.
- GET ${o}/health

## Wire format

- Key: ${w.key}
- Id: ${w.id}
- base64url: ${w.base64url}
- KDF: ${w.kdf.algorithm}. salt = ${w.kdf.salt}. info = "${w.kdf.info.metadata}" for
  metadata, "${w.kdf.info.content}" for content. PIN: ${w.kdf.pin}
- Cipher: ${w.cipher.algorithm}. nonce = ${w.cipher.nonce}

## Envelope schema

The .json envelope is a JSON object with cleartext protocol fields
(${w.envelope.cleartext.join(", ")}) and one encrypted field
(${w.envelope.encrypted}). ${w.envelope.note}

## Reference

${"@p00f/core"} is the supported reference implementation of this wire format.
`;
}
