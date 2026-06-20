import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { poofCreate, poofRead, poofInfo, poofBurn } from "../src/mcp/tools";
import type { HttpLike } from "../src/shared/core";

const base = "https://poof.test";

function capturing(): { http: HttpLike; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const http: HttpLike = async (url, init) => {
    let body = "";
    const b = init?.body;
    if (typeof b === "string") body = b;
    else if (b instanceof FormData) {
      for (const [k, v] of b as FormData) body += `${k}=${typeof v === "string" ? v : "[blob]"};`;
    }
    calls.push({ url, body });
    return SELF.fetch(url, init);
  };
  return { http, calls };
}

describe("mcp tools", () => {
  it("create then read round-trips text", async () => {
    const { http } = capturing();
    const c = await poofCreate(http, base, { content: "agent handoff payload", reads: 2 });
    expect(c.link).toContain(`${base}/c/`);
    const r = await poofRead(http, c.link);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("agent handoff payload");
  });

  it("info is non-consuming", async () => {
    const { http } = capturing();
    const c = await poofCreate(http, base, { content: "x", reads: 1 });
    const i = await poofInfo(http, c.link);
    expect(i.exists).toBe(true);
    expect(i.revealsRemaining).toBe(1);
  });

  it("requires confirm before revealing a secret-kind clip", async () => {
    const { http } = capturing();
    const c = await poofCreate(http, base, { content: "sk-secret-value", kind: "secret", reads: 2 });
    const blocked = await poofRead(http, c.link);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("confirm_required");
    const ok = await poofRead(http, c.link, { confirm: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.text).toBe("sk-secret-value");
  });

  it("never sends the Fragment Key to the server", async () => {
    const { http, calls } = capturing();
    const c = await poofCreate(http, base, { content: "zero knowledge", reads: 2 });
    const frag = c.link.split("#")[1];
    await poofRead(http, c.link, { confirm: true });
    for (const call of calls) {
      expect(call.url).not.toContain(frag);
      expect(call.body).not.toContain(frag);
    }
  });

  it("burns with the owner token", async () => {
    const { http } = capturing();
    const c = await poofCreate(http, base, { content: "bye", reads: 5 });
    expect((await poofBurn(http, c.link, c.ownerToken)).ok).toBe(true);
    const r = await poofRead(http, c.link);
    expect(r.ok).toBe(false);
  });
});
