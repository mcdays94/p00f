import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("harness", () => {
  it("reaches a ClipDO instance over RPC", async () => {
    const stub = env.CLIP.getByName("smoke");
    expect(await stub.ping()).toBe("pong");
  });

  it("serves the worker health endpoint", async () => {
    const res = await SELF.fetch("https://poof.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
