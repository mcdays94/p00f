import { describe, expect, it } from "vitest";
import { createFormPoof } from "../packages/raycast/src/lib/form";

class FakeClipboard {
  copies: Array<{ content: string; options?: { concealed?: boolean } }> = [];
  async copy(content: string, options?: { concealed?: boolean }): Promise<void> {
    this.copies.push({ content, options });
  }
}

const defaults = {
  baseUrl: "https://p00f.me",
  ttlMs: 300_000,
  revealBudget: 1,
  pasteAfterCreate: false,
};

function okHttp(id = "form-poof") {
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

describe("Raycast Create Poof form mapping", () => {
  it("maps text form values into core create fields", async () => {
    const clipboard = new FakeClipboard();
    const { http, requests } = okHttp();

    const created = await createFormPoof(
      {
        http,
        clipboard,
        statPath: async () => ({ isFile: false }),
        readFile: async () => new Uint8Array(),
      },
      defaults,
      {
        text: "const x = 1;\nconsole.log(x)",
        files: [],
        ttl: "custom",
        ttlCustomAmount: "2",
        ttlCustomUnit: "h",
        reveals: "custom",
        revealsCustomAmount: "7",
        pin: "1234",
        secret: false,
        maskedUrl: false,
        revealAnchored: true,
        allowViewerDelete: true,
        requireTurnstile: true,
        showCountdown: false,
      },
    );

    expect(created.link).toMatch(/^https:\/\/p00f\.me\/c\/form-poof#/);
    expect(clipboard.copies).toEqual([{ content: created.link, options: { concealed: true } }]);
    const body = requests[0].init?.body as FormData;
    expect(body.get("ttlMs")).toBe("7200000");
    expect(body.get("revealBudget")).toBe("7");
    expect(body.get("pin")).toBe("1234");
    expect(body.get("requireTurnstile")).toBe("1");
    expect(body.get("allowViewerDelete")).toBe("1");
    expect(body.get("revealAnchored")).toBe("1");
    expect(requests[0].init?.headers).toBeUndefined();
  });

  it("validates mutually exclusive content, PINs, masked URLs, and size", async () => {
    const clipboard = new FakeClipboard();
    const { http } = okHttp();
    const deps = {
      http,
      clipboard,
      statPath: async () => ({ isFile: true }),
      readFile: async () => new Uint8Array([1, 2, 3, 4]),
      maxBytes: 3,
    };

    await expect(
      createFormPoof(deps, defaults, { text: "hello", files: ["/tmp/a.txt"] }),
    ).rejects.toThrow("Choose text or one file, not both");

    await expect(createFormPoof(deps, defaults, { text: "hello", files: [], pin: "123" })).rejects.toThrow(
      "PIN must be 4 to 128 characters",
    );

    await expect(
      createFormPoof(deps, defaults, { text: "hello", files: [], maskedUrl: true }),
    ).rejects.toThrow("Masked URL mode requires one http(s) URL");

    await expect(createFormPoof(deps, defaults, { text: "", files: ["/tmp/big.bin"] })).rejects.toThrow(
      "Too big to poof. Max is 3 B",
    );

    expect(clipboard.copies).toEqual([]);
  });
});
