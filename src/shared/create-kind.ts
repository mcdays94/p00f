// Shared create-side kind policy. This is intentionally about metadata only:
// `kind` lives inside the encrypted metadata blob, so the server never learns it.
// Callers may explicitly choose special kinds like `secret` or `url`, but default
// inference must never silently opt into those recipient-side behaviors.

export function looksLikeCode(s: string): boolean {
  return /\n/.test(s) && /[;{}<>]|=>|\bfunction\b|\bconst\b|\bdef\b|\bclass\b|\bimport\b|#include/.test(s);
}

// Scheme allowlist for the url Kind (ADR-0013). Returns the canonical href
// (URL.href, lowercased scheme, default-port normalization) ONLY when the
// destination parses as a URL and uses http: or https:; otherwise null.
export function safeHttpUrl(s: string): string | null {
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    return null;
  } catch {
    return null;
  }
}

// True when text holds exactly one http(s) URL (a single token, no embedded
// whitespace). A bare host:port stays text by design: no scheme auto-prepend.
export function loneHttpUrl(s: string): string | null {
  const t = s.trim();
  if (!t || /\s/.test(t)) return null;
  return safeHttpUrl(t);
}

export function inferTextKind(text: string): "text" | "code" {
  return looksLikeCode(text) ? "code" : "text";
}

export function inferFileKind(opts: { mime?: string; filename?: string }): "image" | "video" | "audio" | "file" {
  if (opts.mime?.startsWith("image/")) return "image";
  if (opts.mime?.startsWith("video/")) return "video";
  if (opts.mime?.startsWith("audio/")) return "audio";
  return "file";
}

export function inferCreateKind(opts: {
  explicit?: string;
  text?: string;
  mime?: string;
  filename?: string;
  isBinary?: boolean;
}): string {
  if (opts.explicit) return opts.explicit;
  if (opts.text !== undefined) return inferTextKind(opts.text);
  if (opts.isBinary) return "file";
  if (opts.mime || opts.filename) return inferFileKind({ mime: opts.mime, filename: opts.filename });
  return "text";
}
