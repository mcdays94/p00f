// Published wire-format contract (PRD 0002, ADR-0010). This module owns the
// machine-readable description of how a p00f Link is encrypted and addressed,
// so a non-SDK caller can implement decryption. @p00f/core is the reference
// implementation. Pure: string and object building only, no crypto.subtle.
import { base64urlEncode, METADATA_INFO, CONTENT_INFO } from "./crypto";
import { MAX_CLIP_BYTES, INLINE_MAX_BYTES, formatBytes } from "./limits";

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
  // True when the creator required a human Turnstile token to reveal (ADR-0015).
  // When false (the default) any link-holder, including a headless agent, can
  // reveal. Lets an agent decide up front whether it can complete the reveal.
  turnstileRequired: boolean;
  hasContent: boolean;
  sizeBucket: string;
  metadata: string; // base64url AES-GCM ciphertext (12-byte IV prepended)
}

export function buildEnvelope(input: {
  id: string;
  revealsRemaining: number | null;
  pinRequired: boolean;
  turnstileRequired?: boolean;
  size: number;
  metadata: Uint8Array;
}): Envelope {
  return {
    id: input.id,
    revealsRemaining: input.revealsRemaining,
    pinRequired: input.pinRequired,
    turnstileRequired: input.turnstileRequired ?? false,
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
    cleartext: ["id", "revealsRemaining", "pinRequired", "turnstileRequired", "hasContent", "sizeBucket"],
    encrypted: "metadata: base64url AES-GCM ciphertext of the JSON { kind, filename, mime, size, expiresAt, showCountdown }",
    note: "The exact kind, filename, mime, size, and the expiry deadline (expiresAt) are inside the encrypted metadata blob, never in cleartext (ADR-0014). pinRequired and turnstileRequired tell a caller whether it needs the out-of-band PIN/password and/or a human (a turnstileRequired poof cannot be revealed by the machine path).",
  },
} as const;

export interface DiscoveryDoc {
  name: string;
  brand: string;
  description: string;
  zeroKnowledge: string;
  endpoints: Record<string, string>;
  limits: { maxClipBytes: number; inlineMaxBytes: number };
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
      envelope: `GET ${o}/c/:id.json (or GET ${o}/c/:id with Accept: application/json). Non-consuming. Returns the encrypted metadata envelope, including pinRequired and turnstileRequired so a caller knows up front whether it can reveal.`,
      reveal: `POST ${o}/api/clip/:id/reveal. Consuming. JSON body carries { pin } when pinRequired and { turnstile } when turnstileRequired (both optional otherwise). Returns the encrypted content as application/octet-stream; decrypt caller-side. A poof with turnstileRequired=false is revealable by a headless agent with no token (and with the PIN if pinRequired).`,
      meta: `GET ${o}/api/clip/:id/meta. Non-consuming legacy metadata endpoint.`,
      delete: `POST ${o}/api/clip/:id/delete (body: { ownerToken }). Owner-gated early burn.`,
      health: `GET ${o}/health`,
    },
    limits: { maxClipBytes: MAX_CLIP_BYTES, inlineMaxBytes: INLINE_MAX_BYTES },
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
  JSON body carries { pin } when the envelope says pinRequired, and { turnstile }
  when it says turnstileRequired. A poof with turnstileRequired=false needs no
  human and is revealable headlessly.
- POST ${o}/api/clip/:id/delete  body { ownerToken }
  Owner-gated early burn. The owner token is returned once at create and is
  never carried in the link.
- GET ${o}/health

## Limits

- Max content size per poof: ${formatBytes(MAX_CLIP_BYTES)} (encrypted blob). An
  oversized create is rejected with HTTP 413 { error: "too_large", maxBytes }.

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

## Revealing as an agent (no browser required)

A poof link looks like ${o}/c/<id>#<key>. The part after '#' is the Fragment
Key and is NEVER sent to the server. To reveal without a browser:

1. Split the link on '#': the path gives <id>; the fragment is the base64url key.
2. GET ${o}/c/<id>.json. If turnstileRequired is true, a human Turnstile
   challenge is required and you cannot reveal headlessly; stop here. If
   pinRequired is true, you need the PIN/password the sharer gave you.
3. POST ${o}/api/clip/<id>/reveal with a JSON body of { pin } if pinRequired
   (otherwise an empty POST). The response body is AES-GCM ciphertext laid out as
   iv(12) || ciphertext+tag.
4. Derive the content key with ${w.kdf.algorithm}: salt = ${w.kdf.salt}, info =
   "${w.kdf.info.content}", IKM = the 32-byte key (with the PIN bytes appended
   when a PIN is set). Decrypt the reveal bytes. The metadata blob from step 2
   decrypts the same way with info = "${w.kdf.info.metadata}" and no PIN.

@p00f/core implements all of this; an agent that can run JS can call it directly
instead of reimplementing the crypto.

## Reference

${"@p00f/core"} is the supported reference implementation of this wire format.
`;
}
