import { ClipDO } from "./clip-do";
import type { Env } from "./types";
import { generateClipId, base64urlEncode, generateOwnerToken } from "../shared/crypto";
import { buildEnvelope, discoveryDoc, llmsTxt } from "../shared/wire";
import { SANDBOX_HTML, SANDBOX_CSP } from "../shared/sandbox-doc";
import { verifyTurnstile } from "./turnstile";
import { sha256B64, randomSaltB64 } from "./hash";

export { ClipDO };
export type { Env };

const MINUTE = 60_000;
const ALLOWED_TTL_MS = [5 * MINUTE, 60 * MINUTE, 24 * 60 * MINUTE, 7 * 24 * 60 * MINUTE];
const DEFAULT_TTL_MS = 5 * MINUTE;
const ALLOWED_BUDGET = [1, 3, 10, -1];
const DEFAULT_BUDGET = 1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Credential-less CORS for the JSON API (PRD 0002 request hygiene). Note the
// deliberate absence of Access-Control-Allow-Credentials: a Link is a bearer
// capability in its fragment, never a cookie, so the API never reflects an
// origin or grants credentialed cross-site access.
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// CSP for the key-holding app document (ADR-0012). The load-bearing clause is
// script-src WITHOUT 'unsafe-inline': an injected inline script cannot execute,
// so it cannot read location.hash (the Fragment Key). app.js is an external
// module from 'self'; Turnstile loads its script and iframe from its origin;
// the reveal sandbox is a blob: iframe. The sandbox itself carries its own,
// separate minimal CSP (see buildSandboxHtml).
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob: https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Request hygiene applied to every worker-generated response (PRD 0002): a
// no-referrer policy and credential-less CORS always; no-store plus a cache
// bypass on clip data so ciphertext is never cached and cannot outlive a burn;
// Vary: Accept on content-negotiated routes.
function harden(res: Response, opts: { noStore?: boolean; vary?: boolean } = {}): Response {
  const h = new Headers(res.headers);
  h.set("referrer-policy", "no-referrer");
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  if (opts.noStore) {
    h.set("cache-control", "no-store, private");
    h.set("cdn-cache-control", "no-store");
  }
  if (opts.vary) h.set("vary", "Accept");
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: h });
}

function clampTtl(v: number): number {
  return ALLOWED_TTL_MS.includes(v) ? v : DEFAULT_TTL_MS;
}
function clampBudget(v: number): number {
  return ALLOWED_BUDGET.includes(v) ? v : DEFAULT_BUDGET;
}

// Identity-free rate-limit floor for the machine path (ADR-0011). Uses the GA
// Workers ratelimit binding when configured; if absent, allows (a self-hoster
// adds the binding). Enforced per data center, so it is a floor, not a hard cap.
async function underCreateFloor(env: Env, ip: string | null): Promise<boolean> {
  const rl = env.CREATE_LIMIT;
  if (!rl) return true;
  const { success } = await rl.limit({ key: ip ?? "anon" });
  return success;
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  // Browser path: a valid Turnstile token lifts the caller above the floor.
  // Machine path (CLI, MCP, agents): no human to solve Turnstile, so anonymous
  // create is allowed under the identity-free rate-limit floor (ADR-0011).
  const ip = request.headers.get("CF-Connecting-IP");
  const token = form.get("turnstile");
  const humanVerified =
    typeof token === "string" && token.length > 0
      ? await verifyTurnstile(token, env.TURNSTILE_SECRET, ip)
      : false;
  if (!humanVerified && !(await underCreateFloor(env, ip))) {
    return json({ error: "rate_limited" }, 429);
  }

  const meta = form.get("meta");
  const content = form.get("content");
  if (!meta || typeof meta === "string" || !content || typeof content === "string") {
    return json({ error: "bad_request" }, 400);
  }

  const maxBytes = Number(env.MAX_CLIP_BYTES);
  if (content.size > maxBytes) return json({ error: "too_large", maxBytes }, 413);

  const ttlMs = clampTtl(Number(form.get("ttlMs")));
  const revealBudget = clampBudget(Number(form.get("revealBudget")));
  const pinRaw = form.get("pin");
  const pin = typeof pinRaw === "string" && /^\d{4}$/.test(pinRaw) ? pinRaw : undefined;

  // The client generates the id so it can salt the key derivation with it
  // before uploading (ADR-0009). Fall back to a server id if absent (tests).
  const provided = form.get("id");
  const id =
    typeof provided === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(provided)
      ? provided
      : generateClipId();
  const metadata = new Uint8Array(await meta.arrayBuffer());
  const contentBytes = new Uint8Array(await content.arrayBuffer());

  const ownerToken = generateOwnerToken();
  const ownerSalt = randomSaltB64();
  const ownerHash = await sha256B64(ownerSalt + ownerToken);

  await env.CLIP.getByName(id).create({
    metadata,
    content: contentBytes,
    ttlMs,
    revealBudget,
    size: content.size,
    pin,
    ownerHash,
    ownerSalt,
    inlineMax: Number(env.INLINE_MAX_BYTES),
  });

  return json({ id, ownerToken });
}

async function handleDelete(id: string, env: Env, request: Request): Promise<Response> {
  let body: { ownerToken?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // no body
  }
  const ownerToken = typeof body.ownerToken === "string" ? body.ownerToken : undefined;
  if (!ownerToken) return json({ error: "owner_token_required" }, 400);
  const r = await env.CLIP.getByName(id).deleteWithOwner(ownerToken);
  return json({ ok: r.ok }, r.ok ? 200 : 403);
}

async function handleMeta(id: string, env: Env): Promise<Response> {
  const m = await env.CLIP.getByName(id).getMeta();
  if (!m.exists) return json({ exists: false }, 404);
  return json({
    exists: true,
    metadata: base64urlEncode(m.metadata),
    revealsRemaining: m.revealsRemaining,
    expiresAt: m.expiresAt,
    pinRequired: m.pinRequired,
    size: m.size,
  });
}

// Content-negotiated metadata envelope (POOF-13). Non-consuming: it returns the
// cleartext protocol fields plus the encrypted metadata blob, never plaintext
// or the Fragment Key (ADR-0003, ADR-0010).
async function handleEnvelope(id: string, env: Env): Promise<Response> {
  const m = await env.CLIP.getByName(id).getMeta();
  if (!m.exists) return json({ exists: false }, 404);
  return json(
    buildEnvelope({
      id,
      revealsRemaining: m.revealsRemaining,
      expiresAt: m.expiresAt,
      pinRequired: m.pinRequired,
      size: m.size,
      metadata: m.metadata,
    }),
  );
}

async function handleReveal(id: string, env: Env, request: Request): Promise<Response> {
  let body: { pin?: unknown; turnstile?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // no body (non-PIN reveal)
  }
  const pin = typeof body.pin === "string" ? body.pin : undefined;
  const turnstile = typeof body.turnstile === "string" ? body.turnstile : undefined;

  // Turnstile gates each PIN submission (ADR-0005).
  if (pin) {
    const ok = turnstile
      ? await verifyTurnstile(turnstile, env.TURNSTILE_SECRET, request.headers.get("CF-Connecting-IP"))
      : false;
    if (!ok) return json({ error: "turnstile_failed" }, 403);
  }

  const r = await env.CLIP.getByName(id).reveal(pin);
  if (r.ok) {
    return new Response(r.content, { headers: { "content-type": "application/octet-stream" } });
  }
  const status = r.reason === "gone" ? 410 : r.reason === "locked" ? 423 : 401;
  return json({ error: r.reason, attemptsLeft: r.attemptsLeft }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;
    const wantsJson = (request.headers.get("Accept") ?? "").includes("application/json");

    // Credential-less CORS preflight for the JSON API.
    if (method === "OPTIONS") return harden(new Response(null, { status: 204 }));

    if (p === "/api/health" || p === "/health") return harden(json({ ok: true }));

    // Machine discovery: the wire-format contract as plain text, plus a JSON
    // discovery document when the bare root is fetched with Accept: json. The
    // HTML root still falls through to the SPA shell below.
    if (p === "/llms.txt") {
      return harden(
        new Response(llmsTxt(url.origin), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    }
    if (p === "/" && wantsJson) return harden(json(discoveryDoc(url.origin)), { vary: true });

    // The reveal sandbox document (ADR-0012). Served by the worker (not assets)
    // so it gets its own CSP and is not subject to the .html redirect or SPA
    // fallback. It must NOT carry the app's frame-ancestors 'none', so the app
    // can embed it.
    if (p === "/sandbox.html" && method === "GET") {
      return new Response(SANDBOX_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": SANDBOX_CSP,
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (p === "/api/clip" && method === "POST") {
      return harden(await handleCreate(request, env), { noStore: true });
    }

    // Encrypted envelope: /c/:id.json, or /c/:id with Accept: application/json.
    // Both are non-consuming; the bare /c/:id with an HTML Accept falls through
    // to the SPA shell.
    const cjson = p.match(/^\/c\/([^/]+)\.json$/);
    if (cjson && method === "GET") {
      return harden(await handleEnvelope(cjson[1], env), { noStore: true, vary: true });
    }
    const cbare = p.match(/^\/c\/([^/]+)$/);
    if (cbare && method === "GET" && wantsJson) {
      return harden(await handleEnvelope(cbare[1], env), { noStore: true, vary: true });
    }

    const meta = p.match(/^\/api\/clip\/([^/]+)\/meta$/);
    if (meta && method === "GET") return harden(await handleMeta(meta[1], env), { noStore: true });

    const rev = p.match(/^\/api\/clip\/([^/]+)\/reveal$/);
    if (rev && method === "POST") return harden(await handleReveal(rev[1], env, request), { noStore: true });

    const del = p.match(/^\/api\/clip\/([^/]+)\/delete$/);
    if (del && method === "POST") return harden(await handleDelete(del[1], env, request), { noStore: true });

    if (p.startsWith("/api/")) return harden(new Response("Not found", { status: 404 }));

    // Non-API routes are served by static assets (see wrangler run_worker_first):
    // the SPA shell, including the bare /c/:id reveal page and the HTML root. The
    // HTML document holds the Fragment Key, so it carries a strict CSP (ADR-0012).
    const res = await env.ASSETS.fetch(request);
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      const h = new Headers(res.headers);
      h.set("content-security-policy", APP_CSP);
      h.set("referrer-policy", "no-referrer");
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
