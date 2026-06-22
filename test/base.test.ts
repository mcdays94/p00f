import { describe, it, expect } from "vitest";
import { resolveBase, DEFAULT_POOF_BASE } from "../src/shared/base";

// #24: the published @p00f/cli binary defaults to the live hosted app, not a
// local dev server, so `npx @p00f/cli` just works with no configuration.
// POOF_BASE (or the P00F_BASE alias) overrides it for local development. One
// source of truth used by the CLI and the published wire-format docs so it cannot drift.
describe("resolveBase", () => {
  it("defaults to the hosted app when no env var is set", () => {
    expect(DEFAULT_POOF_BASE).toBe("https://p00f.me");
    expect(resolveBase({})).toBe("https://p00f.me");
  });
  it("uses POOF_BASE when set (local dev points at the dev server)", () => {
    expect(resolveBase({ POOF_BASE: "https://poof.localhost" })).toBe("https://poof.localhost");
  });
  it("falls back to the P00F_BASE alias when POOF_BASE is absent", () => {
    expect(resolveBase({ P00F_BASE: "http://localhost:9173" })).toBe("http://localhost:9173");
  });
  it("prefers POOF_BASE over the P00F_BASE alias", () => {
    expect(resolveBase({ POOF_BASE: "https://a.example", P00F_BASE: "https://b.example" })).toBe(
      "https://a.example",
    );
  });
  it("treats empty-string env values as unset", () => {
    expect(resolveBase({ POOF_BASE: "", P00F_BASE: "" })).toBe("https://p00f.me");
  });
});
