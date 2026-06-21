// Pure CLI helpers for the poof CLI (POOF-16). No Node APIs here, so this module
// is unit-testable in the Workers pool alongside the rest of the suite.

export type Command = "create" | "get" | "info" | "burn";

export interface ParsedArgs {
  command: Command;
  positional: string[];
  flags: Record<string, string | boolean>;
}

const COMMANDS: Record<string, Command> = {
  create: "create",
  get: "get",
  cat: "get",
  info: "info",
  burn: "burn",
};

// Flags that never take a value (presence means true).
const BOOLEAN_FLAGS = new Set(["json", "copy", "no-countdown", "require-turnstile"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: Command | undefined;
  let i = 0;

  if (argv.length && !argv[0].startsWith("-") && COMMANDS[argv[0]]) {
    command = COMMANDS[argv[0]];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(a);
    }
  }

  return { command: command ?? "create", positional, flags };
}

// The server clamps TTL to {5m, 1h, 1d, 7d} (ADR-0002), so the CLI accepts only
// those and fails fast on anything else rather than silently snapping to default.
const TTL_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

export function ttlToMs(s: string | boolean | undefined): number | undefined {
  if (s === undefined || s === true || s === false) return undefined;
  const v = TTL_MS[s];
  if (v === undefined) throw new Error(`invalid --ttl ${s} (use 5m, 1h, 1d, or 7d)`);
  return v;
}

export function readsToBudget(s: string | boolean | undefined): number | undefined {
  if (s === undefined || s === true || s === false) return undefined;
  if (s === "unlimited" || s === "inf") return -1;
  if (s === "1" || s === "3" || s === "10") return Number(s);
  throw new Error(`invalid --reads ${s} (use 1, 3, 10, or unlimited)`);
}

export function inferKind(opts: {
  explicit?: string;
  mime?: string;
  filename?: string;
  isBinary?: boolean;
}): string {
  if (opts.explicit) return opts.explicit;
  if (opts.mime && opts.mime.startsWith("image/")) return "image";
  if (opts.isBinary) return "file";
  if (opts.filename) return "file";
  return "text";
}
