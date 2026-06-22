import { describe, it, expect } from "vitest";
import {
  clampTtlMs,
  clampRevealBudget,
  MIN_TTL_MS,
  MAX_TTL_MS,
  DEFAULT_TTL_MS,
  MAX_REVEAL_BUDGET,
} from "../src/shared/limits";

// #22: custom TTL + reveal budget are clamped to shared bounds (one source of
// truth for the Worker, the web client, and the CLI).
describe("clampTtlMs", () => {
  it("accepts an in-range custom value", () => {
    expect(clampTtlMs(1_800_000)).toBe(1_800_000); // 30 minutes
  });
  it("clamps below MIN up and above MAX down", () => {
    expect(clampTtlMs(1_000)).toBe(MIN_TTL_MS);
    expect(clampTtlMs(MAX_TTL_MS + 1_000_000)).toBe(MAX_TTL_MS);
  });
  it("falls back to the default on non-positive or non-finite input", () => {
    expect(clampTtlMs(0)).toBe(DEFAULT_TTL_MS);
    expect(clampTtlMs(-5)).toBe(DEFAULT_TTL_MS);
    expect(clampTtlMs(NaN)).toBe(DEFAULT_TTL_MS);
  });
});

describe("clampRevealBudget", () => {
  it("keeps -1 as unlimited", () => {
    expect(clampRevealBudget(-1)).toBe(-1);
  });
  it("accepts an arbitrary positive count and clamps over-max", () => {
    expect(clampRevealBudget(7)).toBe(7);
    expect(clampRevealBudget(MAX_REVEAL_BUDGET + 50)).toBe(MAX_REVEAL_BUDGET);
  });
  it("falls back to the default on sub-1 or non-finite input", () => {
    expect(clampRevealBudget(0)).toBe(1);
    expect(clampRevealBudget(NaN)).toBe(1);
  });
});
