import { describe, expect, it } from "vitest";
import { createClipboardPoof } from "../packages/raycast/src/lib/clipboard";

class FakeClipboard {
  copies: Array<{ content: string; options?: { concealed?: boolean } }> = [];
  pastes: string[] = [];

  async copy(content: string, options?: { concealed?: boolean }): Promise<void> {
    this.copies.push({ content, options });
  }

  async paste(content: string): Promise<void> {
    this.pastes.push(content);
  }
}

const defaults = {
  baseUrl: "https://p00f.me",
  ttlMs: 300_000,
  revealBudget: 1,
  pasteAfterCreate: false,
};

function okHttp(id = "clipboard-poof") {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  return {
    requests,
    http: async (input: string, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({ id, ownerToken: "owner" }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
}

async function expectFailure(run: () => Promise<unknown>, message: string) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    return;
  }
  throw new Error(`Expected failure containing: ${message}`);
}

describe("Raycast Poof Clipboard", () => {
  it("prefers a clipboard file over clipboard text", async () => {
    const clipboard = new FakeClipboard();
    const { http, requests } = okHttp("clipboard-file");

    const created = await createClipboardPoof(
      {
        http,
        clipboard,
        readClipboard: async () => ({ file: "/tmp/screenshot.png", text: "ignored text" }),
        statPath: async () => ({ isFile: true }),
        readFile: async () => new Uint8Array([1, 2, 3]),
      },
      { ...defaults, pasteAfterCreate: true },
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/clipboard-file#/);
    expect(clipboard.copies).toEqual([{ content: created.link, options: { concealed: true } }]);
    expect(clipboard.pastes).toEqual([created.link]);
    expect(requests).toHaveLength(1);
    expect(requests[0].init?.headers).toBeUndefined();
  });

  it("falls back to clipboard text", async () => {
    const clipboard = new FakeClipboard();
    const { http } = okHttp("clipboard-text");

    const created = await createClipboardPoof(
      {
        http,
        clipboard,
        readClipboard: async () => ({ text: "const x = 1;\nconsole.log(x)" }),
        statPath: async () => ({ isFile: false }),
        readFile: async () => new Uint8Array(),
      },
      defaults,
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/clipboard-text#/);
    expect(clipboard.copies).toHaveLength(1);
  });

  it("treats HTML as text only when plain text is absent", async () => {
    const clipboard = new FakeClipboard();
    const { http } = okHttp("clipboard-html");

    const created = await createClipboardPoof(
      {
        http,
        clipboard,
        readClipboard: async () => ({ html: "<strong>hello</strong>" }),
        statPath: async () => ({ isFile: false }),
        readFile: async () => new Uint8Array(),
      },
      defaults,
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/clipboard-html#/);
    expect(clipboard.copies).toHaveLength(1);
  });

  it("fails closed for empty clipboard, directories, multiple files, and oversized files", async () => {
    const clipboard = new FakeClipboard();
    const { http } = okHttp();
    const baseDeps = {
      http,
      clipboard,
      readFile: async () => new Uint8Array([1, 2, 3, 4]),
    };

    await expectFailure(
      () => createClipboardPoof(
        { ...baseDeps, readClipboard: async () => ({}), statPath: async () => ({ isFile: false }) },
        defaults,
      ),
      "Clipboard is empty",
    );

    await expectFailure(
      () => createClipboardPoof(
        {
          ...baseDeps,
          readClipboard: async () => ({ file: "/tmp/folder" }),
          statPath: async () => ({ isFile: false, isDirectory: true }),
        },
        defaults,
      ),
      "p00f can share one text or file item at a time",
    );

    await expectFailure(
      () => createClipboardPoof(
        {
          ...baseDeps,
          readClipboard: async () => ({ file: ["/tmp/a", "/tmp/b"] }),
          statPath: async () => ({ isFile: true }),
        },
        defaults,
      ),
      "p00f can share one text or file item at a time",
    );

    await expectFailure(
      () => createClipboardPoof(
        {
          ...baseDeps,
          readClipboard: async () => ({ file: "/tmp/big.bin" }),
          statPath: async () => ({ isFile: true }),
          maxBytes: 3,
        },
        defaults,
      ),
      "Too big to poof. Max is 3 B",
    );

    expect(clipboard.copies).toEqual([]);
    expect(clipboard.pastes).toEqual([]);
  });
});
