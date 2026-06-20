import { describe, it, expect } from "vitest";
import { buildLink, parseLink } from "../src/shared/link";
import { generateMasterKey, generateClipId, encodeKey } from "../src/shared/crypto";

describe("link", () => {
  it("builds origin/c/<id>#<key> and round-trips through parse", () => {
    const key = generateMasterKey();
    const id = generateClipId();
    const link = buildLink({ origin: "https://p00f.test", id, key });
    expect(link).toBe(`https://p00f.test/c/${id}#${encodeKey(key)}`);
    const p = parseLink(link);
    expect(p.origin).toBe("https://p00f.test");
    expect(p.id).toBe(id);
    expect(Array.from(p.key)).toEqual(Array.from(key));
  });

  it("trims a trailing slash on origin", () => {
    const key = generateMasterKey();
    expect(buildLink({ origin: "https://p00f.test/", id: "abc", key })).toBe(
      `https://p00f.test/c/abc#${encodeKey(key)}`,
    );
  });

  it("rejects a link with no Fragment Key", () => {
    expect(() => parseLink("https://p00f.test/c/abc")).toThrow();
  });

  it("rejects a non-clip path", () => {
    const key = generateMasterKey();
    expect(() => parseLink(`https://p00f.test/x/abc#${encodeKey(key)}`)).toThrow();
  });
});
