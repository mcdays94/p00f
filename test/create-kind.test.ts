import { describe, expect, it } from "vitest";
import {
  inferFileKind,
  inferTextKind,
  inferCreateKind,
  loneHttpUrl,
  looksLikeCode,
} from "../src/shared/create-kind";
import { inferCreateKind as inferCreateKindFromCore } from "../src/shared/core";

describe("shared create-kind policy", () => {
  it("detects code-looking text the same way the create UI does", () => {
    expect(looksLikeCode("const x = 1;\nfunction f() { return x; }")).toBe(true);
    expect(looksLikeCode("just a sentence with no code markers")).toBe(false);
    expect(inferTextKind("def foo():\n    return 1")).toBe("code");
    expect(inferTextKind("a plain Poof")).toBe("text");
  });

  it("detects only lone http(s) URLs for explicit masked URL mode", () => {
    expect(loneHttpUrl("https://example.com/a b")).toBeNull();
    expect(loneHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(loneHttpUrl("http://192.168.1.10:8080")).toBe("http://192.168.1.10:8080/");
    expect(loneHttpUrl("javascript:alert(1)")).toBeNull();
    expect(loneHttpUrl("file:///tmp/x")).toBeNull();
  });

  it("infers file kinds from mime first and falls back to generic file", () => {
    expect(inferFileKind({ mime: "image/png" })).toBe("image");
    expect(inferFileKind({ mime: "video/mp4" })).toBe("video");
    expect(inferFileKind({ mime: "audio/mpeg" })).toBe("audio");
    expect(inferFileKind({ filename: "notes.txt" })).toBe("file");
  });

  it("never silently creates secret or url kinds from default inference", () => {
    expect(inferCreateKind({ text: "https://example.com" })).toBe("text");
    expect(inferCreateKind({ text: "API_KEY=abc123" })).toBe("text");
    expect(inferCreateKind({ text: "import x from 'y';\nconsole.log(x)" })).toBe("code");
    expect(inferCreateKind({ explicit: "secret", text: "API_KEY=abc123" })).toBe("secret");
    expect(inferCreateKind({ explicit: "url", text: "https://example.com" })).toBe("url");
  });

  it("is exported from the core barrel for thin shells like Raycast", () => {
    expect(inferCreateKindFromCore({ text: "const x = 1;\nconsole.log(x)" })).toBe("code");
  });
});
