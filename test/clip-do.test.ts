import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { sha256B64, randomSaltB64 } from "../src/worker/hash";

const b = (...n: number[]) => new Uint8Array(n);
const stub = (name: string) => env.CLIP.getByName(name);

describe("ClipDO lifecycle", () => {
  it("stores a clip and returns metadata without consuming the reveal budget", async () => {
    const s = stub("c1");
    await s.create({ metadata: b(1, 2, 3), content: b(9, 9), ttlMs: 60_000, revealBudget: 1, size: 2 });

    const m1 = await s.getMeta();
    expect(m1.exists).toBe(true);
    if (m1.exists) {
      expect(Array.from(m1.metadata)).toEqual([1, 2, 3]);
      expect(m1.revealsRemaining).toBe(1);
      expect(m1.pinRequired).toBe(false);
      expect(m1.size).toBe(2);
    }

    const m2 = await s.getMeta();
    expect(m2.exists && m2.revealsRemaining).toBe(1);
  });

  it("reveal returns content and decrements the budget", async () => {
    const s = stub("c2");
    await s.create({ metadata: b(0), content: b(4, 5, 6), ttlMs: 60_000, revealBudget: 3, size: 3 });

    const r = await s.reveal();
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.content)).toEqual([4, 5, 6]);

    const m = await s.getMeta();
    expect(m.exists && m.revealsRemaining).toBe(2);
  });

  it("burns once the reveal budget is exhausted", async () => {
    const s = stub("c3");
    await s.create({ metadata: b(0), content: b(7), ttlMs: 60_000, revealBudget: 1, size: 1 });

    expect((await s.reveal()).ok).toBe(true);
    expect(await s.getMeta()).toEqual({ exists: false });
    expect(await s.reveal()).toEqual({ ok: false, reason: "gone" });
  });

  it("unlimited budget never burns by reveal count", async () => {
    const s = stub("c4");
    await s.create({ metadata: b(0), content: b(1), ttlMs: 60_000, revealBudget: -1, size: 1 });

    for (let i = 0; i < 5; i++) expect((await s.reveal()).ok).toBe(true);

    const m = await s.getMeta();
    expect(m.exists && m.revealsRemaining).toBe(null);
  });

  it("TTL alarm burns the clip", async () => {
    const s = stub("c5");
    await s.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1 });

    expect(await runDurableObjectAlarm(s)).toBe(true);
    expect(await s.getMeta()).toEqual({ exists: false });
  });

  it("treats an already-expired clip as gone on access", async () => {
    const s = stub("c6");
    await s.create({ metadata: b(1), content: b(2), ttlMs: -1000, revealBudget: 5, size: 1 });

    expect(await s.getMeta()).toEqual({ exists: false });
  });

  it("gates a PIN-protected clip: wrong PIN rejected, correct PIN reveals", async () => {
    const s = stub("pin1");
    await s.create({ metadata: b(1), content: b(2, 3), ttlMs: 60_000, revealBudget: 5, size: 2, pin: "1234" });

    const m = await s.getMeta();
    expect(m.exists && m.pinRequired).toBe(true);

    expect(await s.reveal()).toEqual({ ok: false, reason: "pin_required" });

    const bad = await s.reveal("0000");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("bad_pin");

    const good = await s.reveal("1234");
    expect(good.ok).toBe(true);
    if (good.ok) expect(Array.from(good.content)).toEqual([2, 3]);
  });

  it("locks out after too many wrong PINs, without consuming reveal budget", async () => {
    const s = stub("pin2");
    await s.create({ metadata: b(1), content: b(9), ttlMs: 60_000, revealBudget: 1, size: 1, pin: "1234" });

    for (let i = 0; i < 5; i++) await s.reveal("0000");

    const r = await s.reveal("1234"); // correct, but locked out now
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("locked");

    // wrong attempts never spent the single reveal: the clip still exists
    const m = await s.getMeta();
    expect(m.exists).toBe(true);
  });

  it("owner token authorizes early burn; a wrong token does not", async () => {
    const s = stub("own1");
    const salt = randomSaltB64();
    const token = "owner-secret-xyz";
    const ownerHash = await sha256B64(salt + token);
    await s.create({ metadata: b(1), content: b(2), ttlMs: 60_000, revealBudget: 5, size: 1, ownerHash, ownerSalt: salt });

    expect((await s.deleteWithOwner("wrong-token")).ok).toBe(false);
    expect((await s.getMeta()).exists).toBe(true);

    expect((await s.deleteWithOwner(token)).ok).toBe(true);
    expect(await s.getMeta()).toEqual({ exists: false });
  });
});
