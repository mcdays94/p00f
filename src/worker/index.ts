import { ClipDO } from "./clip-do";
import type { Env } from "./types";
import { generateClipId, base64urlEncode, generateOwnerToken } from "../shared/crypto";
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

    if (p === "/api/health") return json({ ok: true });
    if (p === "/api/clip" && request.method === "POST") return handleCreate(request, env);

    const meta = p.match(/^\/api\/clip\/([^/]+)\/meta$/);
    if (meta && request.method === "GET") return handleMeta(meta[1], env);

    const rev = p.match(/^\/api\/clip\/([^/]+)\/reveal$/);
    if (rev && request.method === "POST") return handleReveal(rev[1], env, request);

    const del = p.match(/^\/api\/clip\/([^/]+)\/delete$/);
    if (del && request.method === "POST") return handleDelete(del[1], env, request);

    if (p.startsWith("/api/")) return new Response("Not found", { status: 404 });

    // Non-API routes are served by static assets (see wrangler run_worker_first).
    return env.ASSETS.fetch(request);
  },
};
