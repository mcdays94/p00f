import {
  create,
  inferTextKind,
  type CreatedClip,
  type HttpLike,
} from "@p00f/core";

export interface RaycastClipboardLike {
  copy(content: string, options?: { concealed?: boolean }): Promise<void>;
  paste?(content: string): Promise<void>;
}

export interface CreateServiceDeps {
  http: HttpLike;
  clipboard: RaycastClipboardLike;
}

export interface CreateTextPoofInput {
  text: string;
  baseUrl: string;
  ttlMs: number;
  revealBudget: number;
  pasteAfterCreate?: boolean;
  requireTurnstile?: boolean;
  allowViewerDelete?: boolean;
  revealAnchored?: boolean;
  showCountdown?: boolean;
}

const te = new TextEncoder();

function friendlyCreateError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("429")) {
    return new Error(
      "p00f is rate limiting anonymous creates. Try again soon.",
    );
  }
  if (message.toLowerCase().includes("failed to fetch")) {
    return new Error("Could not reach p00f.");
  }
  return new Error(message || "Could not create Poof.");
}

export async function createTextPoof(
  deps: CreateServiceDeps,
  input: CreateTextPoofInput,
): Promise<CreatedClip> {
  const content = te.encode(input.text);
  const created = await create(deps.http, input.baseUrl, {
    content,
    meta: {
      kind: inferTextKind(input.text),
      mime: "text/plain",
      size: content.length,
    },
    ttlMs: input.ttlMs,
    revealBudget: input.revealBudget,
    requireTurnstile: input.requireTurnstile,
    allowViewerDelete: input.allowViewerDelete,
    revealAnchored: input.revealAnchored,
    showCountdown: input.showCountdown,
  }).catch((error: unknown) => {
    throw friendlyCreateError(error);
  });

  await deps.clipboard.copy(created.link, { concealed: true });
  if (input.pasteAfterCreate) await deps.clipboard.paste?.(created.link);
  return created;
}
