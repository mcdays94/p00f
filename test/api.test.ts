import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// The test environment configures TURNSTILE_SECRET to Cloudflare's always-pass
// test secret (see wrangler.jsonc), so a present token verifies offline.
function createForm(
  opts: { ttlMs?: number; revealBudget?: number; meta?: Uint8Array; content?: Uint8Array; withToken?: boolean } = {},
): FormData {
  const fd = new FormData();
  if (opts.withToken !== false) fd.set("turnstile", "tok");
  fd.set("ttlMs", String(opts.ttlMs ?? 300_000));
  fd.set("revealBudget", String(opts.revealBudget ?? 1));
  fd.set("meta", new Blob([opts.meta ?? new Uint8Array([1, 2, 3])]));
  fd.set("content", new Blob([opts.content ?? new Uint8Array([10, 20, 30])]));
  return fd;
}

const base = "https://poof.test";

describe("Worker API", () => {
  it("creates, returns metadata, and reveals content end to end", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm() });
    expect(cr.status).toBe(200);
    const { id } = (await cr.json()) as { id: string };
    expect(id).toBeTruthy();

    const mr = await SELF.fetch(`${base}/api/clip/${id}/meta`);
    expect(mr.status).toBe(200);
    const meta = (await mr.json()) as { exists: boolean; revealsRemaining: number; pinRequired: boolean };
    expect(meta.exists).toBe(true);
    expect(meta.revealsRemaining).toBe(1);
    expect(meta.pinRequired).toBe(false);

    const rr = await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" });
    expect(rr.status).toBe(200);
    expect(Array.from(new Uint8Array(await rr.arrayBuffer()))).toEqual([10, 20, 30]);
  });

  it("allows anonymous machine create without Turnstile, under the floor (ADR-0011)", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ withToken: false }) });
    expect(cr.status).toBe(200);
    const { id } = (await cr.json()) as { id: string };
    expect(id).toBeTruthy();
  });

  it("returns 404 for an unknown clip", async () => {
    const mr = await SELF.fetch(`${base}/api/clip/does-not-exist/meta`);
    expect(mr.status).toBe(404);
    expect(await mr.json()).toEqual({ exists: false });
  });

  it("burns after the budget is exhausted (second reveal is 410)", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 1 }) });
    const { id } = (await cr.json()) as { id: string };

    expect((await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" })).status).toBe(200);
    expect((await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" })).status).toBe(410);
  });

  it("gates a PIN-protected clip via the API", async () => {
    const fd = createForm({ revealBudget: 5 });
    fd.set("pin", "4321");
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: fd });
    const { id } = (await cr.json()) as { id: string };

    const meta = (await (await SELF.fetch(`${base}/api/clip/${id}/meta`)).json()) as { pinRequired: boolean };
    expect(meta.pinRequired).toBe(true);

    // no PIN -> 401
    expect((await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" })).status).toBe(401);

    // wrong PIN (+ turnstile) -> 401
    const wrong = await SELF.fetch(`${base}/api/clip/${id}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "0000", turnstile: "tok" }),
    });
    expect(wrong.status).toBe(401);

    // correct PIN (+ turnstile) -> 200 + content
    const ok = await SELF.fetch(`${base}/api/clip/${id}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "4321", turnstile: "tok" }),
    });
    expect(ok.status).toBe(200);
    expect(Array.from(new Uint8Array(await ok.arrayBuffer()))).toEqual([10, 20, 30]);
  });

  it("opt-in requireTurnstile gates reveal until a human token arrives; non-consuming (ADR-0015)", async () => {
    const fd = createForm({ revealBudget: 3 });
    fd.set("requireTurnstile", "1");
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: fd });
    const { id } = (await cr.json()) as { id: string };

    const meta = (await (await SELF.fetch(`${base}/api/clip/${id}/meta`)).json()) as { turnstileRequired: boolean };
    expect(meta.turnstileRequired).toBe(true);

    // No token -> 403, and it must not consume the budget.
    expect((await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" })).status).toBe(403);
    const stillThere = (await (await SELF.fetch(`${base}/api/clip/${id}/meta`)).json()) as { revealsRemaining: number };
    expect(stillThere.revealsRemaining).toBe(3);

    // Valid token (test secret accepts "tok") -> 200.
    const ok = await SELF.fetch(`${base}/api/clip/${id}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstile: "tok" }),
    });
    expect(ok.status).toBe(200);
  });

  it("a default clip reports turnstileRequired=false and reveals with no token (agent path, ADR-0015)", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 2 }) });
    const { id } = (await cr.json()) as { id: string };
    const meta = (await (await SELF.fetch(`${base}/api/clip/${id}/meta`)).json()) as { turnstileRequired: boolean };
    expect(meta.turnstileRequired).toBe(false);
    expect((await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" })).status).toBe(200);
  });

  it("owner token deletes a clip; a link-holder without it cannot", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 5 }) });
    const { id, ownerToken } = (await cr.json()) as { id: string; ownerToken: string };
    expect(ownerToken).toBeTruthy();

    const wrong = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: "nope" }),
    });
    expect(wrong.status).toBe(403);
    expect((await SELF.fetch(`${base}/api/clip/${id}/meta`)).status).toBe(200);

    const ok = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken }),
    });
    expect(ok.status).toBe(200);
    expect((await SELF.fetch(`${base}/api/clip/${id}/meta`)).status).toBe(404);
  });
});
