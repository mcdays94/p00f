import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { create, type HttpLike } from "../src/shared/core";
import { parseLink } from "../src/shared/link";
import { decryptBlob, base64urlDecode } from "../src/shared/crypto";

const te = new TextEncoder();
const td = new TextDecoder();
const base = "https://poof.test";
const http: HttpLike = (url, init) => SELF.fetch(url, init);

async function makeClip(opts: { kind?: string; content?: string; revealBudget?: number; pin?: string } = {}) {
  const content = te.encode(opts.content ?? "hello-secret-content");
  const created = await create(http, base, {
    content,
    meta: { kind: opts.kind ?? "my-custom-kind-xyz", mime: "text/plain", size: content.length },
    revealBudget: opts.revealBudget ?? 3,
    pin: opts.pin,
  });
  return { created, ...parseLink(created.link) };
}

describe("POOF-13: content negotiation, discovery, request hygiene", () => {
  it("serves /health as an alias of /api/health", async () => {
    const res = await SELF.fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the encrypted envelope at /c/:id.json (non-consuming, decryptable)", async () => {
    const { id, key } = await makeClip({ kind: "my-custom-kind-xyz", revealBudget: 3 });

    const res = await SELF.fetch(`${base}/c/${id}.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const env = (await res.json()) as Record<string, unknown> & { metadata: string };
    expect(env.id).toBe(id);
    expect(env.hasContent).toBe(true);
    expect(env.pinRequired).toBe(false);
    expect(env.revealsRemaining).toBe(3);
    expect(env.sizeBucket).toBe("tiny");
    // Only the coarse bucket is cleartext; the exact size is not.
    expect(env).not.toHaveProperty("size");

    // The encrypted blob decrypts to the real metadata, proving it is ciphertext
    // of the true kind, not a cleartext copy.
    const metaBytes = await decryptBlob(key, id, "metadata", base64urlDecode(env.metadata));
    const meta = JSON.parse(td.decode(metaBytes)) as { kind: string };
    expect(meta.kind).toBe("my-custom-kind-xyz");
  });

  it("never puts the fragment key, the plaintext kind, or content in the envelope", async () => {
    const { created, id } = await makeClip({ kind: "my-custom-kind-xyz", content: "hello-secret-content" });
    const frag = created.link.split("#")[1];

    const raw = await (await SELF.fetch(`${base}/c/${id}.json`)).text();
    expect(raw).not.toContain(frag);
    expect(raw).not.toContain("my-custom-kind-xyz"); // kind is encrypted
    expect(raw).not.toContain("hello-secret-content"); // content is never here
  });

  it("negotiates the envelope on /c/:id via Accept: application/json", async () => {
    const { id } = await makeClip();
    const res = await SELF.fetch(`${base}/c/${id}`, { headers: { Accept: "application/json" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("vary")).toBe("Accept");
    const env = (await res.json()) as { id: string };
    expect(env.id).toBe(id);
  });

  it("returns a 404 envelope for an unknown clip", async () => {
    const res = await SELF.fetch(`${base}/c/nope-nope-nope.json`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ exists: false });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("marks envelope and reveal responses no-store with no-referrer and credential-less CORS", async () => {
    const { id } = await makeClip({ revealBudget: 2 });

    const env = await SELF.fetch(`${base}/c/${id}.json`);
    expect(env.headers.get("cache-control")).toContain("no-store");
    expect(env.headers.get("cdn-cache-control")).toContain("no-store");
    expect(env.headers.get("referrer-policy")).toBe("no-referrer");
    expect(env.headers.get("vary")).toBe("Accept");
    expect(env.headers.get("access-control-allow-origin")).toBe("*");
    expect(env.headers.get("access-control-allow-credentials")).toBeNull();

    const rev = await SELF.fetch(`${base}/api/clip/${id}/reveal`, { method: "POST" });
    expect(rev.status).toBe(200);
    expect(rev.headers.get("cache-control")).toContain("no-store");
    expect(rev.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("answers a credential-less CORS preflight", async () => {
    const { id } = await makeClip();
    const pre = await SELF.fetch(`${base}/c/${id}.json`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("publishes a JSON discovery doc at / under Accept negotiation", async () => {
    const res = await SELF.fetch(`${base}/`, { headers: { Accept: "application/json" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toBe("Accept");
    const doc = (await res.json()) as { wireFormat: { kdf: { algorithm: string } }; endpoints: Record<string, string> };
    expect(doc.wireFormat.kdf.algorithm).toBe("HKDF-SHA-256");
    expect(doc.endpoints.reveal).toContain("/api/clip/");
  });

  it("serves the reveal sandbox document with its own framable CSP (ADR-0012)", async () => {
    const res = await SELF.fetch(`${base}/sandbox.html`);
    expect(res.status).toBe(200); // worker-served, not a .html redirect
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'unsafe-inline'"); // its own bootstrap may run
    expect(csp).toContain("frame-ancestors 'self'"); // the app may embed it
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain("poof-sandbox-ready");
  });

  it("publishes the wire format at /llms.txt", async () => {
    const res = await SELF.fetch(`${base}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const txt = await res.text();
    expect(txt).toContain("HKDF-SHA-256");
    expect(txt).toContain("AES-GCM-256");
    expect(txt).toContain("fragment");
  });
});
