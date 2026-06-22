import { describe, it, expect } from "vitest";
import { parseArgs, ttlToMs, readsToBudget, inferKind } from "../src/cli/args";

describe("cli args", () => {
  it("defaults to create with a file positional", () => {
    const a = parseArgs(["secrets.env"]);
    expect(a.command).toBe("create");
    expect(a.positional).toEqual(["secrets.env"]);
  });

  it("parses get, cat (alias), info, and burn commands", () => {
    expect(parseArgs(["get", "L"]).command).toBe("get");
    expect(parseArgs(["cat", "L"]).command).toBe("get");
    expect(parseArgs(["info", "L"]).command).toBe("info");
    const burn = parseArgs(["burn", "L", "--token", "T"]);
    expect(burn.command).toBe("burn");
    expect(burn.flags.token).toBe("T");
  });

  it("parses value flags, boolean flags, and key=value", () => {
    const a = parseArgs(["f", "--ttl", "1h", "--reads", "3", "--json", "--kind=secret"]);
    expect(a.flags.ttl).toBe("1h");
    expect(a.flags.reads).toBe("3");
    expect(a.flags.json).toBe(true);
    expect(a.flags.kind).toBe("secret");
  });

  it("treats --reveal-anchored as a boolean flag, not consuming the next arg (#27)", () => {
    // It is in BOOLEAN_FLAGS, so the following positional (the file) must not be
    // swallowed as its value.
    const a = parseArgs(["secrets.env", "--reveal-anchored"]);
    expect(a.flags["reveal-anchored"]).toBe(true);
    expect(a.positional).toEqual(["secrets.env"]);
  });

  it("treats a bare --pin as boolean true (prompt), and --pin 1234 as a value", () => {
    expect(parseArgs(["f", "--pin"]).flags.pin).toBe(true);
    expect(parseArgs(["f", "--pin", "1234"]).flags.pin).toBe("1234");
  });

  it("maps preset and custom ttl/reads, clamping to bounds and rejecting garbage (#22)", () => {
    expect(ttlToMs("5m")).toBe(300_000);
    expect(ttlToMs("7d")).toBe(604_800_000);
    expect(ttlToMs(undefined)).toBeUndefined();
    // custom values are now accepted (rejected before #22)
    expect(ttlToMs("30m")).toBe(1_800_000);
    expect(ttlToMs("6h")).toBe(21_600_000);
    expect(ttlToMs("2d")).toBe(172_800_000);
    // out-of-range clamps to the 30-day max; garbage still throws
    expect(ttlToMs("60d")).toBe(30 * 24 * 60 * 60_000);
    expect(() => ttlToMs("abc")).toThrow();
    expect(() => ttlToMs("10x")).toThrow();
    expect(readsToBudget("unlimited")).toBe(-1);
    expect(readsToBudget("10")).toBe(10);
    // arbitrary positive counts are now accepted (rejected before #22)
    expect(readsToBudget("7")).toBe(7);
    expect(readsToBudget("50")).toBe(50);
    // over-max clamps to 100; non-positive / garbage throws
    expect(readsToBudget("500")).toBe(100);
    expect(() => readsToBudget("0")).toThrow();
    expect(() => readsToBudget("-3")).toThrow();
  });

  it("infers kind with explicit override and image/binary heuristics", () => {
    expect(inferKind({ explicit: "secret" })).toBe("secret");
    expect(inferKind({ mime: "image/png" })).toBe("image");
    expect(inferKind({ isBinary: true })).toBe("file");
    expect(inferKind({ filename: "a.txt" })).toBe("file");
    expect(inferKind({})).toBe("text");
  });
});
