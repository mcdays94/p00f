import { ClipDO } from "./clip-do";
import type { Env } from "./types";
import { generateClipId, base64urlEncode } from "../shared/crypto";
import { verifyTurnstile } from "./turnstile";

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

async function handleCreate(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const token = form.get("turnstile");
  if (typeof token !== "string") return json({ error: "turnstile_required" }, 403);
  const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET, request.headers.get("CF-Connecting-IP"));
  if (!ok) return json({ error: "turnstile_failed" }, 403);

  const meta = form.get("meta");
  const content = form.get("content");
  if (!meta || typeof meta === "string" || !content || typeof content === "string") {
    return json({ error: "bad_request" }, 400);
  }

  const maxBytes = Number(env.MAX_CLIP_BYTES);
  if (content.size > maxBytes) return json({ error: "too_large", maxBytes }, 413);

  const ttlMs = clampTtl(Number(form.get("ttlMs")));
  const revealBudget = clampBudget(Number(form.get("revealBudget")));

  const id = generateClipId();
  const metadata = new Uint8Array(await meta.arrayBuffer());
  const contentBytes = new Uint8Array(await content.arrayBuffer());

  await env.CLIP.getByName(id).create({
    metadata,
    content: contentBytes,
    ttlMs,
    revealBudget,
    size: content.size,
  });

  return json({ id });
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

async function handleReveal(id: string, env: Env): Promise<Response> {
  const r = await env.CLIP.getByName(id).reveal();
  if (!r.ok) return json({ error: r.reason }, 410);
  return new Response(r.content, {
    headers: { "content-type": "application/octet-stream" },
  });
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
    if (rev && request.method === "POST") return handleReveal(rev[1], env);

    if (p.startsWith("/api/")) return new Response("Not found", { status: 404 });

    // Non-API routes are served by static assets (see wrangler run_worker_first).
    return env.ASSETS.fetch(request);
  },
};
