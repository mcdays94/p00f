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

  it("treats a bare --pin as boolean true (prompt), and --pin 1234 as a value", () => {
    expect(parseArgs(["f", "--pin"]).flags.pin).toBe(true);
    expect(parseArgs(["f", "--pin", "1234"]).flags.pin).toBe("1234");
  });

  it("maps ttl and reads, rejecting unsupported values", () => {
    expect(ttlToMs("5m")).toBe(300_000);
    expect(ttlToMs("7d")).toBe(604_800_000);
    expect(ttlToMs(undefined)).toBeUndefined();
    expect(() => ttlToMs("30m")).toThrow();
    expect(readsToBudget("unlimited")).toBe(-1);
    expect(readsToBudget("10")).toBe(10);
    expect(() => readsToBudget("7")).toThrow();
  });

  it("infers kind with explicit override and image/binary heuristics", () => {
    expect(inferKind({ explicit: "secret" })).toBe("secret");
    expect(inferKind({ mime: "image/png" })).toBe("image");
    expect(inferKind({ isBinary: true })).toBe("file");
    expect(inferKind({ filename: "a.txt" })).toBe("file");
    expect(inferKind({})).toBe("text");
  });
});
