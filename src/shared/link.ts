// Link build and parse for Poof (ADR-0001, ADR-0010). The Link carries the clip
// id in the path and the Fragment Key in the URL fragment. The fragment never
// reaches the server, so build/parse are pure and run anywhere @p00f/core runs.
import { encodeKey, decodeKey } from "./crypto";

export interface ParsedLink {
  origin: string;
  id: string;
  key: Uint8Array;
}

export function buildLink(input: { origin: string; id: string; key: Uint8Array }): string {
  const origin = input.origin.replace(/\/+$/, "");
  return `${origin}/c/${input.id}#${encodeKey(input.key)}`;
}

export function parseLink(link: string): ParsedLink {
  const url = new URL(link); // throws on a malformed URL
  const m = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("not a Poof link: bad path");
  const frag = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!frag) throw new Error("not a Poof link: missing Fragment Key");
  return { origin: url.origin, id: m[1], key: decodeKey(frag) };
}
