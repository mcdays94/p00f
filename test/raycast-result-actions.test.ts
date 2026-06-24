import { describe, expect, it } from "vitest";
import {
  burnCreatedPoof,
  copyCreatedLink,
  copyOwnerToken,
  pasteCreatedLink,
} from "../packages/raycast/src/lib/result-actions";

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

describe("Raycast result actions", () => {
  it("copies and pastes the created Link with concealed copy", async () => {
    const clipboard = new FakeClipboard();
    const link = "https://p00f.me/c/abc#key";

    await copyCreatedLink(clipboard, link);
    await pasteCreatedLink(clipboard, link);

    expect(clipboard.copies).toEqual([{ content: link, options: { concealed: true } }]);
    expect(clipboard.pastes).toEqual([link]);
  });

  it("copies the owner token concealed and never needs local persistence", async () => {
    const clipboard = new FakeClipboard();

    await copyOwnerToken(clipboard, "owner-token");

    expect(clipboard.copies).toEqual([{ content: "owner-token", options: { concealed: true } }]);
  });

  it("burns using the owner token from the just-created result", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const http = async (input: string, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    };

    const ok = await burnCreatedPoof(http, {
      link: "https://p00f.me/c/abc#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ownerToken: "owner-token",
    });

    expect(ok).toBe(true);
    expect(requests[0].input).toBe("https://p00f.me/api/clip/abc/delete");
    expect(JSON.parse(requests[0].init?.body as string)).toEqual({ ownerToken: "owner-token" });
  });
});
