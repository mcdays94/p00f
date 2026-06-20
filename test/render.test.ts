import { describe, it, expect } from "vitest";
import { decideRender, looksUtf8, escapeHtml, buildSandboxMessage, safeHttpUrl, clampHeight, formatRemaining, countdownFraction } from "../src/client/render";
import { SANDBOX_HTML, SANDBOX_CSP } from "../src/shared/sandbox-doc";
import { tokenize, detectLanguage, LANGS } from "../src/shared/highlight";

const te = new TextEncoder();
const td = new TextDecoder();

describe("POOF-14: hostile-content render decisions (ADR-0012)", () => {
  it("dispatches text to text-mode and code to code-mode in the sandbox", () => {
    expect(decideRender({ kind: "text", size: 3 }, te.encode("abc")).mode).toBe("text");
    expect(decideRender({ kind: "code", size: 3 }, te.encode("abc")).mode).toBe("code");
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

  it("builds a key-free sandbox message for code that carries plaintext, not markup", () => {
    const bytes = te.encode("const x = 1;\nfunction f() { return x; }");
    const msg = buildSandboxMessage({ mode: "code" }, bytes);
    expect(msg).toEqual({
      type: "poof-render",
      mode: "code",
      text: "const x = 1;\nfunction f() { return x; }",
    });
  });

  it("ships a sandbox doc that renders text safely and never reads the key", () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("frame-ancestors 'self'");
    expect(SANDBOX_HTML).toContain("textContent"); // text rendered as text, never HTML
    expect(SANDBOX_HTML).not.toContain("innerHTML");
    expect(SANDBOX_HTML).not.toMatch(/\blocation\b/); // never touches location.hash
    expect(SANDBOX_HTML).toContain("poof-sandbox-ready");
  });

  it("ships a sandbox doc that wires the code branch through the inlined highlighter", () => {
    // The sandbox handles a code mode in addition to text/image (ADR-0012).
    expect(SANDBOX_HTML).toMatch(/m\.mode\s*===\s*['"]code['"]/);
    // It must NOT introduce external sources or relax the opaque-origin guard.
    expect(SANDBOX_CSP).not.toContain("allow-same-origin");
    expect(SANDBOX_HTML).not.toMatch(/https?:\/\//);
    // The highlighter still routes content through textContent on each token,
    // never through innerHTML or document.write.
    expect(SANDBOX_HTML).not.toContain("document.write");
    // The inlined highlighter is bounded; even with all language grammars
    // inline the served document stays well under the 30 KB budget gzipped.
    // Use raw byte length as a coarse upper bound (gzipped is far smaller).
    expect(SANDBOX_HTML.length).toBeLessThan(30 * 1024);
  });
});

describe("POOF-11: sandbox-side code highlighter (ADR-0012)", () => {
  it("tokenize round-trips: concatenated token text equals the source", () => {
    const src = "const greeting = 'hi';\nfunction f() { return 1 + 2; }";
    const tokens = tokenize(src, "js");
    expect(tokens.map((t) => t[1]).join("")).toBe(src);
  });

  it("tokenize marks JS keywords with the 'k' token type", () => {
    const tokens = tokenize("const x = 1", "js");
    expect(tokens.some((t) => t[0] === "k" && t[1] === "const")).toBe(true);
  });

  it("tokenize marks JS strings with the 's' token type", () => {
    const tokens = tokenize("var s = 'hello';", "js");
    expect(tokens.some((t) => t[0] === "s" && t[1] === "'hello'")).toBe(true);
  });

  it("tokenize falls back to plain text for an unknown language", () => {
    const src = "anything at all";
    const tokens = tokenize(src, "no-such-lang");
    expect(tokens).toEqual([["", "anything at all"]]);
  });

  it("never produces a token text that has been HTML-pre-escaped", () => {
    // The highlighter MUST keep token text as raw source. Escaping happens at
    // the render edge (textContent on each <span>) inside the sandbox. If the
    // tokenizer pre-escaped, an HTML payload would lose its '<' / '>' /
    // ampersand bytes and the user would see "&lt;" on screen.
    const payload = `<script>alert(1)</script><img onerror="x" src=x>`;
    const tokens = tokenize(payload, "js");
    expect(tokens.map((t) => t[1]).join("")).toBe(payload);
    expect(tokens.some((t) => t[1].includes("&lt;"))).toBe(false);
    expect(tokens.some((t) => t[1].includes("&amp;"))).toBe(false);
  });

  it("token types are short class suffixes, never raw HTML tags", () => {
    const payload = `<a href="x">link</a> && other "stuff" /* c */`;
    const tokens = tokenize(payload, "html");
    for (const [type] of tokens) {
      // Class suffixes are empty or a single lowercase letter (a-z).
      expect(type).toMatch(/^[a-z]?$/);
    }
  });

  it("detects common languages", () => {
    expect(detectLanguage("const x = 1;\nfunction f() { return x; }")).toBe("js");
    expect(detectLanguage("def foo():\n    return 1")).toBe("python");
    expect(detectLanguage("SELECT id FROM users WHERE name = 'a'")).toBe("sql");
    expect(detectLanguage("<div class='x'>hi</div>")).toBe("html");
    expect(detectLanguage('{"a": 1, "b": [true, false, null]}')).toBe("json");
    expect(detectLanguage("package main\nfunc main() { fmt.Println(\"hi\") }")).toBe("go");
    expect(detectLanguage("fn main() { let mut x = 1; println!(\"{}\", x); }")).toBe("rust");
  });

  it("falls back to 'plain' for content that matches no language", () => {
    expect(detectLanguage("just some plain English words written here")).toBe("plain");
    expect(detectLanguage("")).toBe("plain");
  });

  it("ships a curated set of languages including the suggested ones", () => {
    const have = Object.keys(LANGS);
    for (const lang of ["js", "json", "html", "css", "python", "bash", "go", "rust", "sql", "yaml", "markdown"]) {
      expect(have).toContain(lang);
    }
  });

  it("plain-lang tokenize emits the source as a single plain token", () => {
    const src = "anything";
    expect(tokenize(src, "plain")).toEqual([["", "anything"]]);
  });
});

describe("POOF-13: masked URL Kind (ADR-0013)", () => {
  it("decideRender returns 'link' mode for kind 'url'", () => {
    const d = decideRender({ kind: "url", size: 21 }, te.encode("https://example.com/x"));
    expect(d.mode).toBe("link");
  });

  it("safeHttpUrl returns the canonical href for http and https URLs", () => {
    expect(safeHttpUrl("http://example.com/")).toBe("http://example.com/");
    expect(safeHttpUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    // bare host:port (a typical local-network destination) is accepted and
    // normalized to a trailing slash by URL.href.
    expect(safeHttpUrl("http://192.168.1.42:8080")).toBe("http://192.168.1.42:8080/");
    // uppercased scheme is normalized to lowercase by the URL parser.
    expect(safeHttpUrl("HTTPS://example.com/")).toBe("https://example.com/");
  });

  it("safeHttpUrl returns null for empty or non-URL input", () => {
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    // A relative URL with no base throws inside new URL() and is rejected.
    expect(safeHttpUrl("/relative/path")).toBeNull();
    expect(safeHttpUrl("//evil.example")).toBeNull();
  });

  // The load-bearing security property of ADR-0013: a non-http(s) scheme MUST
  // never produce a non-null result from safeHttpUrl, because the reveal path
  // uses that return value as the anchor's href. A `javascript:` or `data:`
  // href would execute in the key-holding parent origin and could exfiltrate
  // the Fragment Key (ADR-0012).
  it("safeHttpUrl rejects every non-http(s) scheme so it can never become clickable", () => {
    const hostile = [
      "javascript:alert(1)",
      "javascript:void(0)",
      "JAVASCRIPT:alert(1)",
      "javaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:text/plain;base64,YWJj",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
      "about:blank",
      "chrome://settings",
      "ftp://example.com/",
      "ws://example.com/",
      "wss://example.com/",
      "mailto:alice@example.com",
      "tel:+1234567890",
    ];
    for (const s of hostile) {
      expect(safeHttpUrl(s), `expected null for ${s}`).toBeNull();
    }
  });
});

describe("#15: reveal-box auto-height", () => {
  it("clampHeight returns raw when between min and max", () => {
    expect(clampHeight(300, 120, 600)).toBe(300);
  });
  it("clampHeight floors to min when raw is too small or negative", () => {
    expect(clampHeight(40, 120, 600)).toBe(120);
    expect(clampHeight(0, 120, 600)).toBe(120);
    expect(clampHeight(-50, 120, 600)).toBe(120);
  });
  it("clampHeight caps at max when raw exceeds it", () => {
    expect(clampHeight(900, 120, 600)).toBe(600);
  });
  it("clampHeight rounds fractional pixel values", () => {
    expect(clampHeight(123.4, 120, 600)).toBe(123);
    expect(clampHeight(123.6, 120, 600)).toBe(124);
  });
  it("clampHeight collapses NaN and Infinity to min so an inert size message stays safe", () => {
    expect(clampHeight(Number.NaN, 120, 600)).toBe(120);
    expect(clampHeight(Number.POSITIVE_INFINITY, 120, 600)).toBe(120);
    expect(clampHeight(Number.NEGATIVE_INFINITY, 120, 600)).toBe(120);
  });
  it("clampHeight returns min when max is below min (degenerate viewport)", () => {
    expect(clampHeight(500, 200, 100)).toBe(200);
  });
  it("sandbox doc posts a poof-size message with scrollHeight", () => {
    // The reveal box auto-sizes by listening for {type:"poof-size", height}
    // from the opaque-origin sandbox. The size message carries only a number.
    expect(SANDBOX_HTML).toContain("poof-size");
    expect(SANDBOX_HTML).toContain("scrollHeight");
  });
  it("sandbox CSP still excludes allow-same-origin", () => {
    // Defence in depth: the auto-height work must not relax the opaque-origin
    // guarantee. The iframe is still mounted with sandbox=allow-scripts only.
    expect(SANDBOX_CSP).not.toContain("allow-same-origin");
  });
});

describe("ADR-0014: countdown helpers", () => {
  it("formats remaining time, coarsening with scale", () => {
    expect(formatRemaining(0)).toBe("0s");
    expect(formatRemaining(-5000)).toBe("0s");
    expect(formatRemaining(45_000)).toBe("45s");
    expect(formatRemaining(125_000)).toBe("2m 5s");
    expect(formatRemaining(3_660_000)).toBe("1h 1m");
  });
  it("computes the depleting bar fraction from time-left over the viewing window", () => {
    const opened = 1000;
    const expires = 11000; // 10s window from page open
    expect(countdownFraction(1000, opened, expires)).toBe(1); // just opened
    expect(countdownFraction(6000, opened, expires)).toBe(0.5); // halfway
    expect(countdownFraction(11000, opened, expires)).toBe(0); // at expiry
    expect(countdownFraction(20000, opened, expires)).toBe(0); // past expiry
  });
  it("clamps to [0,1] and handles a degenerate window", () => {
    expect(countdownFraction(0, 1000, 11000)).toBe(1); // before open -> full
    expect(countdownFraction(5000, 5000, 5000)).toBe(0); // zero-length window
  });
});
