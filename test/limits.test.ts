import { describe, it, expect } from "vitest";
import {
  clampTtlMs,
  clampRevealBudget,
  createExpiryMs,
  MIN_TTL_MS,
  MAX_TTL_MS,
  DEFAULT_TTL_MS,
  MAX_REVEAL_BUDGET,
  UNREVEALED_CAP_MS,
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

// ADR-0017: create-time expiry policy. A creation-anchored Poof expires at
// createdAt + ttl. A reveal-anchored Poof has no deadline until first reveal, so
// at create it is bounded only by the unrevealed cap (the 30-day max TTL); its
// ttl clock starts on the first Reveal, not here.
describe("createExpiryMs", () => {
  const createdAt = 1_000_000;
  it("creation-anchored: createdAt + ttl", () => {
    expect(createExpiryMs(createdAt, 300_000, false)).toBe(createdAt + 300_000);
  });
  it("reveal-anchored: createdAt + unrevealed cap, ignoring ttl", () => {
    expect(createExpiryMs(createdAt, 300_000, true)).toBe(createdAt + UNREVEALED_CAP_MS);
  });
  it("unrevealed cap equals the max TTL (30 days)", () => {
    expect(UNREVEALED_CAP_MS).toBe(MAX_TTL_MS);
    expect(UNREVEALED_CAP_MS).toBe(30 * 24 * 60 * 60_000);
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
