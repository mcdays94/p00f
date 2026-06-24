import { describe, expect, it } from "vitest";
import { createTextPoof } from "../packages/raycast/src/lib/create-service";

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

describe("Raycast create service", () => {
  it("creates a text Poof through core, copies concealed, and optionally pastes", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const http = async (input: string, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({ id: "raycast-test", ownerToken: "owner-token" }), {
        headers: { "content-type": "application/json" },
      });
    };
    const clipboard = new FakeClipboard();

    const created = await createTextPoof(
      { http, clipboard },
      {
        text: "const x = 1;\nconsole.log(x)",
        baseUrl: "https://p00f.me",
        ttlMs: 300_000,
        revealBudget: 1,
        pasteAfterCreate: true,
      },
    );

    expect(created.id).toBe("raycast-test");
    expect(created.ownerToken).toBe("owner-token");
    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/raycast-test#/);
    expect(clipboard.copies).toEqual([{ content: created.link, options: { concealed: true } }]);
    expect(clipboard.pastes).toEqual([created.link]);
    expect(requests).toHaveLength(1);
    expect(requests[0].input).toBe("https://p00f.me/api/clip");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.headers).toBeUndefined();
  });

  it("maps anonymous create rate limits and leaves the clipboard untouched", async () => {
    const http = async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    const clipboard = new FakeClipboard();

    await expect(
      createTextPoof(
        { http, clipboard },
        {
          text: "hello",
          baseUrl: "https://p00f.me",
          ttlMs: 300_000,
          revealBudget: 1,
          pasteAfterCreate: true,
        },
      ),
    ).rejects.toThrow("p00f is rate limiting anonymous creates");

    expect(clipboard.copies).toEqual([]);
    expect(clipboard.pastes).toEqual([]);
  });
});
