import { describe, expect, it } from "vitest";
import { createSelectedTextPoof } from "../packages/raycast/src/lib/selection";

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
