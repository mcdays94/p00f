import { ClipDO } from "./clip-do";
import type { Env } from "./types";

export { ClipDO };
export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    // Non-API routes are served by static assets (see wrangler run_worker_first).
    return env.ASSETS.fetch(request);
  },
};
