import { describe, it, expect } from "vitest";
import { verifyTurnstile } from "../src/worker/turnstile";

describe("verifyTurnstile", () => {
  it("passes with the always-pass test secret", async () => {
    expect(await verifyTurnstile("any-token", "1x0000000000000000000000000000000AA", null)).toBe(true);
  });

  it("fails with the always-fail test secret", async () => {
    expect(await verifyTurnstile("any-token", "2x0000000000000000000000000000000AA", null)).toBe(false);
  });
});
