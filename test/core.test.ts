import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { create, read, info, burn, type HttpLike } from "../src/shared/core";

const te = new TextEncoder();
const td = new TextDecoder();
const base = "https://poof.test";

// Wraps the Worker's fetch and records every request URL and body, so a test can
// assert the Fragment Key never leaves for the network.
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

describe("@p00f/core", () => {
  it("create then read round-trips plaintext and metadata", async () => {
    const { http } = capturing();
    const created = await create(http, base, {
      content: te.encode("hello agents"),
      meta: { kind: "text", mime: "text/plain", size: 12 },
      revealBudget: 1,
    });
    expect(created.link).toContain(`${base}/c/`);
    expect(created.ownerToken).toBeTruthy();

    const r = await read(http, created.link);
    expect(r.ok).toBe(true);
    expect(td.decode(r.content as Uint8Array)).toBe("hello agents");
    expect(r.meta?.kind).toBe("text");
  });

  it("never sends the Fragment Key to the server", async () => {
    const { http, calls } = capturing();
    const created = await create(http, base, {
      content: te.encode("secret value"),
      meta: { kind: "secret", size: 12 },
      revealBudget: 3,
    });
    const frag = created.link.split("#")[1];
    expect(frag).toBeTruthy();

    await info(http, created.link);
    await read(http, created.link);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url).not.toContain(frag);
      expect(c.body).not.toContain(frag);
    }
  });

  it("info is non-consuming; read consumes and then the clip is gone", async () => {
    const { http } = capturing();
    const created = await create(http, base, {
      content: te.encode("once"),
      meta: { kind: "text", size: 4 },
      revealBudget: 1,
    });
    const i1 = await info(http, created.link);
    expect(i1.exists).toBe(true);
    expect(i1.revealsRemaining).toBe(1);

    const r1 = await read(http, created.link);
    expect(r1.ok).toBe(true);

    const r2 = await read(http, created.link);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("gone");
  });

  it("round-trips a PIN-protected clip and rejects a wrong PIN", async () => {
    const { http } = capturing();
    const created = await create(http, base, {
      content: te.encode("pin me"),
      meta: { kind: "secret", size: 6 },
      revealBudget: 5,
      pin: "4321",
    });
    const wrong = await read(http, created.link, { pin: "0000" });
    expect(wrong.ok).toBe(false);
    const ok = await read(http, created.link, { pin: "4321" });
    expect(ok.ok).toBe(true);
    expect(td.decode(ok.content as Uint8Array)).toBe("pin me");
  });

  it("round-trips a variable-length password and gates it server-side (ADR-0004)", async () => {
    const { http } = capturing();
    const password = "correct-horse-battery-staple";
    const created = await create(http, base, {
      content: te.encode("classified"),
      meta: { kind: "secret", size: 10 },
      revealBudget: 5,
      pin: password,
    });
    // The Worker now treats a non-4-digit secret as a real PIN: it stores the
    // hash, so the server reports the clip as PIN-gated (not silently dropped).
    const i = await info(http, created.link);
    expect(i.pinRequired).toBe(true);
    const wrong = await read(http, created.link, { pin: "correct-horse" });
    expect(wrong.ok).toBe(false);
    const ok = await read(http, created.link, { pin: password });
    expect(ok.ok).toBe(true);
    expect(td.decode(ok.content as Uint8Array)).toBe("classified");
  });

  it("folds showCountdown=false into the encrypted metadata, default stays on (ADR-0014)", async () => {
    const { http } = capturing();
    const onClip = await create(http, base, {
      content: te.encode("a"),
      meta: { kind: "text", size: 1 },
      revealBudget: 1,
    });
    // Default on: no field is written, so the recipient defaults to showing it.
    expect((await info(http, onClip.link)).meta?.showCountdown).toBeUndefined();

    const offClip = await create(http, base, {
      content: te.encode("b"),
      meta: { kind: "text", size: 1 },
      revealBudget: 1,
      showCountdown: false,
    });
    expect((await info(http, offClip.link)).meta?.showCountdown).toBe(false);
  });

  it("burns with the owner token so a later read is gone", async () => {
    const { http } = capturing();
    const created = await create(http, base, {
      content: te.encode("burn me"),
      meta: { kind: "text", size: 7 },
      revealBudget: 5,
    });
    expect((await burn(http, created.link, created.ownerToken)).ok).toBe(true);
    const r = await read(http, created.link);
    expect(r.ok).toBe(false);
  });
});
