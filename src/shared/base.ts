// The base URL of the p00f deployment the CLI talks to. The published @p00f/cli
// binary defaults to the live hosted app so `npx @p00f/cli` works with no
// configuration (#24); set POOF_BASE (or the P00F_BASE alias) to point a local
// build at a dev server, e.g. POOF_BASE=https://poof.localhost. Defined once so
// the default is shared by the CLI and the published wire-format docs (llms.txt
// and the discovery doc) and cannot drift between them.
export const DEFAULT_POOF_BASE = "https://p00f.me";

export interface BaseEnv {
  POOF_BASE?: string;
  P00F_BASE?: string;
}

// Resolve the base URL from an environment bag (process.env). Empty-string
// values are treated as unset, so an exported-but-blank POOF_BASE still falls
// back to the hosted default rather than producing an invalid empty base.
export function resolveBase(env: BaseEnv): string {
  return env.POOF_BASE || env.P00F_BASE || DEFAULT_POOF_BASE;
}
