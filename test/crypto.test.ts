import { describe, it, expect } from "vitest";
import * as c from "../src/shared/crypto";

const td = new TextDecoder();
const te = new TextEncoder();
const clipId = "Zm9vYmFyYmF6";

describe("crypto", () => {
  it("round-trips content with the same master key", async () => {
    const master = c.generateMasterKey();
    const blob = await c.encryptBlob(master, clipId, "content", te.encode("hello poof"));
    const out = await c.decryptBlob(master, clipId, "content", blob);
    expect(td.decode(out)).toBe("hello poof");
  });

  it("fails to decrypt with a wrong master key", async () => {
    const master = c.generateMasterKey();
    const wrong = c.generateMasterKey();
    const blob = await c.encryptBlob(master, clipId, "content", new Uint8Array([1, 2, 3]));
    await expect(c.decryptBlob(wrong, clipId, "content", blob)).rejects.toBeTruthy();
  });

  it("uses distinct keys for metadata and content roles", async () => {
    const master = c.generateMasterKey();
    const meta = await c.encryptBlob(master, clipId, "metadata", new Uint8Array([9, 9, 9]));
    await expect(c.decryptBlob(master, clipId, "content", meta)).rejects.toBeTruthy();
  });

  it("PIN gates the content key but leaves the metadata key independent", async () => {
    const master = c.generateMasterKey();
    const content = await c.encryptBlob(master, clipId, "content", new Uint8Array([1, 2, 3, 4]), "1234");
    expect(Array.from(await c.decryptBlob(master, clipId, "content", content, "1234"))).toEqual([1, 2, 3, 4]);
    await expect(c.decryptBlob(master, clipId, "content", content)).rejects.toBeTruthy();
    await expect(c.decryptBlob(master, clipId, "content", content, "0000")).rejects.toBeTruthy();

    const meta = await c.encryptBlob(master, clipId, "metadata", new Uint8Array([7]));
    expect(Array.from(await c.decryptBlob(master, clipId, "metadata", meta))).toEqual([7]);
  });

  it("encodes keys as url-safe base64 without padding and round-trips", () => {
    const k = c.generateMasterKey();
    const s = c.encodeKey(k);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(c.decodeKey(s))).toEqual(Array.from(k));
    expect(k.length).toBe(32);
  });

  it("generates distinct, unguessable ids and owner tokens", () => {
    expect(c.generateClipId()).not.toBe(c.generateClipId());
    expect(c.generateClipId()).not.toMatch(/[+/=]/);
    expect(c.generateOwnerToken().length).toBeGreaterThanOrEqual(40);
  });
});
