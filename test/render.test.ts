import { describe, it, expect } from "vitest";
import { decideRender, looksUtf8, escapeHtml, buildSandboxMessage } from "../src/client/render";
import { SANDBOX_HTML, SANDBOX_CSP } from "../src/shared/sandbox-doc";

const te = new TextEncoder();
const td = new TextDecoder();

describe("POOF-14: hostile-content render decisions (ADR-0012)", () => {
  it("renders text and code as escaped text in the sandbox", () => {
    expect(decideRender({ kind: "text", size: 3 }, te.encode("abc")).mode).toBe("text");
    expect(decideRender({ kind: "code", size: 3 }, te.encode("abc")).mode).toBe("text");
  });

  it("renders non-SVG images in the sandbox", () => {
    const d = decideRender({ kind: "image", mime: "image/png", size: 4 }, new Uint8Array([1, 2, 3, 4]));
    expect(d.mode).toBe("image");
    expect(d.mime).toBe("image/png");
  });

  it("forces SVG to a download as octet-stream, never inline", () => {
    const byKind = decideRender({ kind: "svg", mime: "image/svg+xml", size: 5 }, te.encode("<svg>"));
    const byMime = decideRender({ kind: "image", mime: "image/svg+xml", size: 5 }, te.encode("<svg>"));
    expect(byKind.mode).toBe("download");
    expect(byKind.mime).toBe("application/octet-stream");
    expect(byMime.mode).toBe("download"); // svg mime wins over the image branch
  });

  it("treats file as a download", () => {
    expect(decideRender({ kind: "file", filename: "a.bin", size: 9 }, new Uint8Array([0, 1, 2])).mode).toBe("download");
  });

  it("flags secret for masked rendering", () => {
    expect(decideRender({ kind: "secret", size: 6 }, te.encode("hunter")).mode).toBe("secret");
  });

  it("shows an unknown UTF-8 kind as text and an unknown binary kind as a download", () => {
    expect(decideRender({ kind: "weird-kind", size: 5 }, te.encode("hello")).mode).toBe("text");
    expect(decideRender({ kind: "weird-kind", size: 4 }, new Uint8Array([0, 255, 1, 254])).mode).toBe("download");
  });

  it("detects UTF-8 versus binary", () => {
    expect(looksUtf8(te.encode("héllo"))).toBe(true);
    expect(looksUtf8(new Uint8Array([0x00, 0x01]))).toBe(false); // NUL
    expect(looksUtf8(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false); // invalid UTF-8
  });

  it("escapes HTML so script payloads cannot become markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("builds a key-free sandbox message for text and image", () => {
    const textMsg = buildSandboxMessage({ mode: "text" }, te.encode("plain secret"));
    expect(textMsg).toEqual({ type: "poof-render", mode: "text", text: "plain secret" });

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const imgMsg = buildSandboxMessage({ mode: "image", mime: "image/png" }, bytes);
    expect(imgMsg.type).toBe("poof-render");
    expect(imgMsg.mode).toBe("image");
    if (imgMsg.mode === "image") {
      expect(imgMsg.mime).toBe("image/png");
      expect(td.decode(new Uint8Array(imgMsg.bytes))).toBe(td.decode(bytes));
    }
    // The builder takes only (decision, bytes): no key parameter exists. The
    // opaque-origin isolation of the sandbox document itself is proven by the
    // Playwright check (the sandbox cannot read the parent's location.hash).
    expect(buildSandboxMessage.length).toBe(2);
  });

  it("ships a sandbox doc that renders text safely and never reads the key", () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("frame-ancestors 'self'");
    expect(SANDBOX_HTML).toContain("textContent"); // text rendered as text, never HTML
    expect(SANDBOX_HTML).not.toContain("innerHTML");
    expect(SANDBOX_HTML).not.toContain("location"); // never touches location.hash
    expect(SANDBOX_HTML).toContain("poof-sandbox-ready");
  });
});
