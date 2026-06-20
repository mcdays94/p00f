import { describe, it, expect } from "vitest";
import { sizeBucket, buildEnvelope, discoveryDoc, llmsTxt, WIRE_FORMAT } from "../src/shared/wire";
import { METADATA_INFO, CONTENT_INFO } from "../src/shared/crypto";

describe("wire format contract", () => {
  it("buckets size coarsely without leaking the exact byte length", () => {
    expect(sizeBucket(0)).toBe("tiny");
    expect(sizeBucket(1023)).toBe("tiny");
    expect(sizeBucket(1024)).toBe("small");
    expect(sizeBucket(102_399)).toBe("small");
    expect(sizeBucket(102_400)).toBe("medium");
    expect(sizeBucket(1_048_575)).toBe("medium");
    expect(sizeBucket(1_048_576)).toBe("large");
    expect(sizeBucket(10_000_000)).toBe("large");
  });

  it("builds an envelope with only coarse cleartext and the encrypted blob", () => {
    const env = buildEnvelope({
      id: "abc",
      revealsRemaining: 1,
      pinRequired: false,
      size: 42,
      metadata: new Uint8Array([1, 2, 3, 4]),
    });
    expect(env.sizeBucket).toBe("tiny");
    expect(env.hasContent).toBe(true);
    expect(env.metadata).toBeTruthy();
    // The exact size is never a cleartext field; only the coarse bucket is.
    expect(env).not.toHaveProperty("size");
    // The expiry deadline moved into the encrypted metadata (ADR-0014); it must
    // not appear as a cleartext envelope field.
    expect(env).not.toHaveProperty("expiresAt");
  });

  it("publishes the same HKDF info strings the crypto derivation uses", () => {
    expect(WIRE_FORMAT.kdf.info.metadata).toBe(METADATA_INFO);
    expect(WIRE_FORMAT.kdf.info.content).toBe(CONTENT_INFO);
  });

  it("describes the endpoints and wire format in the discovery doc", () => {
    const d = discoveryDoc("https://p00f.test/");
    expect(d.wireFormat.kdf.algorithm).toBe("HKDF-SHA-256");
    expect(d.wireFormat.cipher.algorithm).toBe("AES-GCM-256");
    expect(d.endpoints.reveal).toContain("/api/clip/:id/reveal");
    expect(d.endpoints.envelope).toContain("/c/:id.json");
    // origin trailing slash is normalised
    expect(d.endpoints.health).toBe("GET https://p00f.test/health");
  });

  it("renders llms.txt with the decryptable wire format and the fragment rule", () => {
    const txt = llmsTxt("https://p00f.test");
    expect(txt).toContain("HKDF-SHA-256");
    expect(txt).toContain("AES-GCM-256");
    expect(txt).toContain("poof/metadata/v1");
    expect(txt).toContain("poof/content/v1");
    expect(txt).toContain("fragment");
    // No em-dashes in published content (house rule).
    expect(txt).not.toContain("\u2014");
  });
});
