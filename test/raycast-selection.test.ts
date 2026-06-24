import { describe, expect, it } from "vitest";
import { createSelectedPoof, createSelectedTextPoof } from "../packages/raycast/src/lib/selection";

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

describe("Raycast Poof Selection", () => {
  it("prefers one selected Finder file over filename-like selected text", async () => {
    const clipboard = new FakeClipboard();
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const http = async (input: string, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({ id: "selected-image", ownerToken: "owner" }), {
        headers: { "content-type": "application/json" },
      });
    };

    const created = await createSelectedPoof(
      {
        http,
        clipboard,
        getSelectedFinderItems: async () => [{ path: "/tmp/photo.png" }],
        getSelectedText: async () => {
          throw new Error("should not read selected filename as text");
        },
        statPath: async () => ({ isFile: true }),
        readFile: async () => new Uint8Array([137, 80, 78, 71]),
      },
      {
        baseUrl: "https://p00f.me",
        ttlMs: 300_000,
        revealBudget: 1,
        pasteAfterCreate: false,
      },
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/selected-image#/);
    expect(clipboard.copies).toEqual([{ content: created.link, options: { concealed: true } }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].init?.headers).toBeUndefined();
  });

  it("creates a Poof from selected text using preference defaults", async () => {
    const clipboard = new FakeClipboard();
    const http = async () =>
      new Response(JSON.stringify({ id: "selected-text", ownerToken: "owner" }), {
        headers: { "content-type": "application/json" },
      });

    const created = await createSelectedTextPoof(
      { http, clipboard, getSelectedText: async () => "function f() {\n  return 1;\n}" },
      {
        baseUrl: "https://p00f.me",
        ttlMs: 300_000,
        revealBudget: 1,
        pasteAfterCreate: true,
      },
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/selected-text#/);
    expect(clipboard.copies).toEqual([{ content: created.link, options: { concealed: true } }]);
    expect(clipboard.pastes).toEqual([created.link]);
  });

  it("fails closed when no selected text is available", async () => {
    const clipboard = new FakeClipboard();

    await expect(
      createSelectedTextPoof(
        {
          http: async () => new Response(null),
          clipboard,
          getSelectedText: async () => {
            throw new Error("no selection");
          },
        },
        {
          baseUrl: "https://p00f.me",
          ttlMs: 300_000,
          revealBudget: 1,
          pasteAfterCreate: true,
        },
      ),
    ).rejects.toThrow("No selected text to poof");

    expect(clipboard.copies).toEqual([]);
    expect(clipboard.pastes).toEqual([]);
  });
});
