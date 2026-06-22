import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// Viewer-initiated delete (ADR-0016): an opt-in, creator-set flag that lets any
// link-holder burn the poof early via POST /api/clip/:id/burn, with no owner
// token. When the creator did not opt in, the burn is forbidden and the poof is
// untouched, preserving ADR-0008's rule that a link is not a destroy capability.

const b = (...n: number[]) => new Uint8Array(n);
const stub = (name: string) => env.CLIP.getByName(name);
const base = "https://poof.test";

function createForm(opts: { revealBudget?: number; allowViewerDelete?: boolean } = {}): FormData {
  const fd = new FormData();
  fd.set("turnstile", "tok");
  fd.set("ttlMs", "300000");
  fd.set("revealBudget", String(opts.revealBudget ?? 5));
  if (opts.allowViewerDelete) fd.set("allowViewerDelete", "1");
  fd.set("meta", new Blob([new Uint8Array([1, 2, 3])]));
  fd.set("content", new Blob([new Uint8Array([10, 20, 30])]));
  return fd;
}

describe("ClipDO.deleteByViewer: opt-in viewer burn (ADR-0016)", () => {
  it("burns when the creator allowed viewer delete", async () => {
    const s = stub("vd-allowed");
    await s.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1, allowViewerDelete: true });
    const r = await s.deleteByViewer();
    expect(r).toEqual({ ok: true });
    expect(await s.getMeta()).toEqual({ exists: false });
  });

  it("is forbidden and non-destructive when not allowed", async () => {
    const s = stub("vd-forbidden");
    await s.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1 });
    const r = await s.deleteByViewer();
    expect(r).toEqual({ ok: false, reason: "forbidden" });
    // A disallowed viewer-delete must not destroy the poof.
    expect((await s.getMeta()).exists).toBe(true);
  });

  it("returns reason 'gone' when the clip is already gone", async () => {
    const s = stub("vd-gone");
    await s.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 1, size: 1, allowViewerDelete: true });
    const rev = await s.reveal(); // a 1-reveal budget burns the row at reveal time
    expect(rev.ok).toBe(true);
    const r = await s.deleteByViewer();
    expect(r).toEqual({ ok: false, reason: "gone" });
  });

  it("publishes allowViewerDelete in getMeta (true when set, false by default)", async () => {
    const on = stub("vd-meta-on");
    await on.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1, allowViewerDelete: true });
    expect(await on.getMeta()).toMatchObject({ exists: true, allowViewerDelete: true });

    const off = stub("vd-meta-off");
    await off.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1 });
    expect(await off.getMeta()).toMatchObject({ exists: true, allowViewerDelete: false });
  });
});

describe("Worker /api/clip/:id/burn: viewer burn (ADR-0016)", () => {
  it("burns a poof that opted in; the envelope advertises it and the poof goes away", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({ allowViewerDelete: true }) });
    const { id } = (await cr.json()) as { id: string };

    const envRes = await SELF.fetch(`${base}/c/${id}.json`);
    expect(envRes.status).toBe(200);
    expect(((await envRes.json()) as { allowViewerDelete: boolean }).allowViewerDelete).toBe(true);

    const res = await SELF.fetch(`${base}/api/clip/${id}/burn`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect((await SELF.fetch(`${base}/api/clip/${id}/meta`)).status).toBe(404);
  });

  it("returns 403 forbidden when the creator did not opt in, leaving the poof live", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, { method: "POST", body: createForm({}) });
    const { id } = (await cr.json()) as { id: string };

    const envRes = await SELF.fetch(`${base}/c/${id}.json`);
    expect(((await envRes.json()) as { allowViewerDelete: boolean }).allowViewerDelete).toBe(false);

    const res = await SELF.fetch(`${base}/api/clip/${id}/burn`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "forbidden" });

    // Still live after a forbidden viewer-burn.
    expect((await SELF.fetch(`${base}/api/clip/${id}/meta`)).status).toBe(200);
  });

  it("returns 200 reason 'gone' when the poof is already gone", async () => {
    const cr = await SELF.fetch(`${base}/api/clip`, {
      method: "POST",
      body: createForm({ revealBudget: 1, allowViewerDelete: true }),
    });
    const { id } = (await cr.json()) as { id: string };

    const rev = await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" });
    expect(rev.status).toBe(200);

    const res = await SELF.fetch(`${base}/api/clip/${id}/burn`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "gone" });
  });
});
