// Pure CLI helpers for the poof CLI (POOF-16). No Node APIs here, so this module
// is unit-testable in the Workers pool alongside the rest of the suite.
import { clampTtlMs, clampRevealBudget } from "../shared/limits";

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
const BOOLEAN_FLAGS = new Set([
  "json",
  "copy",
  "no-countdown",
  "require-turnstile",
  "viewer-delete",
  "reveal-anchored",
  "no-animation",
  "no-copy",
]);

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

// Custom TTL (#22): accept <number><unit> where unit is m (minutes), h (hours),
// or d (days), e.g. 30m, 6h, 2d. The presets (5m, 1h, 1d, 7d) are just special
// cases. The value is clamped into the shared [MIN_TTL_MS, MAX_TTL_MS] range so
// the CLI and the web agree; an unrecognized format fails fast.
const TTL_UNIT_MS: Record<string, number> = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 };

export function ttlToMs(s: string | boolean | undefined): number | undefined {
  if (s === undefined || s === true || s === false) return undefined;
  const m = /^(\d+)\s*(m|h|d)$/i.exec(s.trim());
  if (!m) throw new Error(`invalid --ttl ${s} (use e.g. 30m, 6h, 2d)`);
  return clampTtlMs(Number(m[1]) * TTL_UNIT_MS[m[2].toLowerCase()]);
}

// Custom reveal budget (#22): any positive integer (clamped to 1..MAX_REVEAL_BUDGET),
// or "unlimited"/"inf" for -1. Was previously limited to {1, 3, 10, unlimited}.
export function readsToBudget(s: string | boolean | undefined): number | undefined {
  if (s === undefined || s === true || s === false) return undefined;
  if (s === "unlimited" || s === "inf") return -1;
  const t = s.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n < 1) throw new Error(`invalid --reads ${s} (use a positive number or "unlimited")`);
    return clampRevealBudget(n);
  }
  throw new Error(`invalid --reads ${s} (use a positive number or "unlimited")`);
}

// Whether the CLI should play the stderr "poof" animation (#26). On by default;
// off when the user passed --no-animation, when --json is set (machine output),
// or when stderr is not a TTY (piped or redirected). Pure so it is unit-testable;
// the caller passes process.stderr.isTTY in.
export function wantsAnimation(flags: Record<string, string | boolean>, isTty: boolean): boolean {
  return isTty && !flags.json && !flags["no-animation"];
}

// The stderr "poof" spinner frame (#26). Mirrors the web button's ascii smoke
// ring (src/client/main.ts): a single smoke glyph that breathes through the
// brand palette beside the label, e.g. "✦ poofing". Pure and deterministic so
// it is unit-testable; poof.ts drives the ticking + stderr I/O. One full cycle
// is POOF_SMOKE.length frames, redrawn in place over a cleared line. The
// optional glyphWrap tints just the smoke glyph (poof.ts passes coral()), so
// the label keeps the default foreground.
const POOF_SMOKE = ["·", "°", "o", "*", "✦", "*", "o", "°"];

export function poofFrame(
  label: string,
  tick: number,
  glyphWrap: (glyph: string) => string = (g) => g,
): string {
  const t = tick < 0 ? 0 : Math.floor(tick);
  return `${glyphWrap(POOF_SMOKE[t % POOF_SMOKE.length])} ${label}`;
}

// Wrap text in the brand smoke coral (#FF5959, the web ring colour) as a
// truecolor SGR sequence, or return it unchanged when color is off. Pure +
// testable; poof.ts decides `enabled` (TTY is already guaranteed by
// wantsAnimation, and it honours the NO_COLOR convention) and passes coral as
// poofFrame's glyphWrap. Resets only the foreground (\x1b[39m), not all SGR.
const CORAL_FG = "\x1b[38;2;255;89;89m";
const FG_RESET = "\x1b[39m";
export function coral(s: string, enabled: boolean): string {
  return enabled ? `${CORAL_FG}${s}${FG_RESET}` : s;
}

// Whether `poof` should copy the created link to the clipboard (#auto-copy). The
// default is "auto when interactive": copy when stdout is a TTY (a human is
// reading the link) but not when it is piped or captured, so `LINK=$(poof file)`
// and scripts are untouched. --no-copy always wins; --copy forces a copy even
// when piped; --json suppresses the auto-default (machine output) unless --copy
// is explicit. Pure so it is unit-testable; poof.ts passes process.stdout.isTTY.
export function wantsCopy(flags: Record<string, string | boolean>, isTty: boolean): boolean {
  if (flags["no-copy"]) return false;
  if (flags.copy) return true;
  if (flags.json) return false;
  return isTty;
}

// The OS clipboard command(s) to try for a platform (process.platform), in
// preference order. poof.ts spawns each in turn and pipes the link to its stdin,
// stopping at the first that succeeds; an unknown platform or a missing tool just
// skips the copy (never fails the create). Pure: no spawning here.
export interface ClipboardCmd {
  cmd: string;
  args: string[];
}

export function clipboardCandidates(platform: string): ClipboardCmd[] {
  if (platform === "darwin") return [{ cmd: "pbcopy", args: [] }];
  if (platform === "win32") return [{ cmd: "clip", args: [] }];
  if (platform === "linux")
    return [
      { cmd: "wl-copy", args: [] }, // Wayland
      { cmd: "xclip", args: ["-selection", "clipboard"] }, // X11
      { cmd: "xsel", args: ["--clipboard", "--input"] }, // X11 alt
    ];
  return [];
}

export function inferKind(opts: {
  explicit?: string;
  mime?: string;
  filename?: string;
  isBinary?: boolean;
}): string {
  if (opts.explicit) return opts.explicit;
  if (opts.mime && opts.mime.startsWith("image/")) return "image";
  if (opts.mime && opts.mime.startsWith("video/")) return "video";
  if (opts.mime && opts.mime.startsWith("audio/")) return "audio";
  if (opts.isBinary) return "file";
  if (opts.filename) return "file";
  return "text";
}
