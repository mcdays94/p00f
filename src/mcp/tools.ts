// MCP tool handlers (POOF-17, ADR-0010). Pure over an injected fetch plus the
// core, so they are unit-testable in the Workers pool. All crypto is caller-side;
// the server only ever sees ciphertext. search and list_recent are intentionally
// absent because they are not zero-knowledge compatible.
import { create, read, info, burn, type HttpLike, type ClipInfo } from "../shared/core";

const te = new TextEncoder();
const td = new TextDecoder();

export interface CreateArgs {
  content: string;
  kind?: string;
  ttlMs?: number;
  reads?: number;
  pin?: string;
}

export async function poofCreate(http: HttpLike, baseUrl: string, args: CreateArgs) {
  const bytes = te.encode(args.content);
  return create(http, baseUrl, {
    content: bytes,
    meta: { kind: args.kind ?? "text", size: bytes.length },
    ttlMs: args.ttlMs,
    revealBudget: args.reads,
    pin: args.pin,
  });
}

export type ReadResultJson =
  | { ok: false; reason: string; note?: string }
  | { ok: true; kind?: string; text?: string; binary?: true; note?: string };

export async function poofRead(
  http: HttpLike,
  link: string,
  args?: { pin?: string; confirm?: boolean },
): Promise<ReadResultJson> {
  // A secret-kind clip returns plaintext into the model context, so require an
  // explicit confirm before spending a reveal (PRD hardening).
  let pre: ClipInfo | null = null;
  try {
    pre = await info(http, link);
  } catch {
    pre = null;
  }
  if (pre?.exists && pre.meta?.kind === "secret" && !args?.confirm) {
    return { ok: false, reason: "confirm_required" };
  }
  const r = await read(http, link, { pin: args?.pin });
  if (!r.ok) {
    if (r.reason === "turnstile")
      return {
        ok: false,
        reason: "turnstile",
        note: "this poof requires a human captcha (Turnstile) to reveal; it cannot be revealed headlessly. Open the link in a browser.",
      };
    return { ok: false, reason: r.reason ?? "error" };
  }
  const content = r.content as Uint8Array;
  if (content.some((b) => b === 0)) {
    return { ok: true, kind: r.meta?.kind, binary: true, note: "binary content; use the CLI or web app to download" };
  }
  return { ok: true, kind: r.meta?.kind, text: td.decode(content) };
}

export async function poofInfo(http: HttpLike, link: string): Promise<ClipInfo> {
  return info(http, link);
}

export async function poofBurn(http: HttpLike, link: string, ownerToken: string): Promise<{ ok: boolean }> {
  return burn(http, link, ownerToken);
}
