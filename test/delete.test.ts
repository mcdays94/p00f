import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { sha256B64, randomSaltB64 } from "../src/worker/hash";

const b = (...n: number[]) => new Uint8Array(n);
const stub = (name: string) => env.CLIP.getByName(name);

// Browser path: a creator clicks "delete now" on a clip that has already been
// expired or burned (e.g. a 1-reveal clip that was just revealed). Before this
// fix the worker returned 403 for both "already gone" and "owner mismatch",
// so the UI showed a misleading "delete failed." for a clip that simply was
// not there to delete. The DO and the worker now distinguish the two reasons
// so the client can show the right message.

function createForm(opts: { revealBudget?: number } = {}): FormData {
  const fd = new FormData();
  fd.set("turnstile", "tok");
  fd.set("ttlMs", "300000");
  fd.set("revealBudget", String(opts.revealBudget ?? 5));
  fd.set("meta", new Blob([new Uint8Array([1, 2, 3])]));
  fd.set("content", new Blob([new Uint8Array([10, 20, 30])]));
  return fd;
}

const base = "https://poof.test";

describe("ClipDO.deleteWithOwner: gone vs forbidden", () => {
  it("returns ok on a live clip with the correct owner token", async () => {
    const s = stub("del-live");
    const salt = randomSaltB64();
    const token = "owner-real";
    const ownerHash = await sha256B64(salt + token);
    await s.create({
      metadata: b(1),
      content: b(2),
      ttlMs: 60_000,
      revealBudget: 5,
      size: 1,
      ownerHash,
      ownerSalt: salt,
    });

    const r = await s.deleteWithOwner(token);
    expect(r).toEqual({ ok: true });
    expect(await s.getMeta()).toEqual({ exists: false });
  });

  it("returns reason 'gone' when the clip is already gone", async () => {
    const s = stub("del-gone");
    const salt = randomSaltB64();
    const token = "owner-real";
    const ownerHash = await sha256B64(salt + token);
    await s.create({
      metadata: b(1),
      content: b(2),
      ttlMs: 60_000,
      revealBudget: 1,
      size: 1,
      ownerHash,
      ownerSalt: salt,
    });

    // Reveal consumes the 1-reveal budget and burns the row, so by the time
    // the creator clicks "delete now" the row is gone.
    const rev = await s.reveal();
    expect(rev.ok).toBe(true);

    const r = await s.deleteWithOwner(token);
    expect(r).toEqual({ ok: false, reason: "gone" });
  });

  it("returns reason 'forbidden' when the owner token does not match", async () => {
    const s = stub("del-forbidden");
    const salt = randomSaltB64();
    const token = "owner-real";
    const ownerHash = await sha256B64(salt + token);
    await s.create({
      metadata: b(1),
      content: b(2),
      ttlMs: 60_000,
      revealBudget: 5,
      size: 1,
      ownerHash,
      ownerSalt: salt,
    });

    const r = await s.deleteWithOwner("wrong-token");
    expect(r).toEqual({ ok: false, reason: "forbidden" });
    // Clip is still live, owner mismatch does not consume it.
    expect((await s.getMeta()).exists).toBe(true);
  });
});

describe("Worker /api/clip/:id/delete: gone vs forbidden", () => {
  it("returns 200 ok:true on a successful delete", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 5 }) });
    const { id, ownerToken } = (await cr.json()) as { id: string; ownerToken: string };

    const res = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 with reason 'gone' when the clip is already gone", async () => {
    // 1-reveal clip: reveal it, then try to delete. The row is burned at reveal
    // time, so delete arrives at an empty DO.
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 1 }) });
    const { id, ownerToken } = (await cr.json()) as { id: string; ownerToken: string };

    const rev = await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" });
    expect(rev.status).toBe(200);

    const res = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "gone" });
  });

  it("returns 403 with reason 'forbidden' when the owner token is wrong", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 5 }) });
    const { id } = (await cr.json()) as { id: string };

    const res = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: "nope" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "forbidden" });

    // Clip is still live after a forbidden attempt.
    expect((await SELF.fetch(`${base}/api/clip/${id}/meta`)).status).toBe(200);
  });

  it("still returns 400 owner_token_required when no token is supplied", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ revealBudget: 5 }) });
    const { id } = (await cr.json()) as { id: string };

    const res = await SELF.fetch(`${base}/api/clip/${id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "owner_token_required" });
  });
});
