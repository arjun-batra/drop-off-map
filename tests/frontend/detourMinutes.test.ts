import { describe, expect, it } from "vitest";
import { validateMaxDetourMinutes } from "../../src/frontend/validation/detourMinutes";

describe("validateMaxDetourMinutes -- FR-002, ux-spec.md section 4.2, design.md section 1.3 (no upper bound)", () => {
  it("happy path: a normal positive integer is valid", () => {
    expect(validateMaxDetourMinutes("10")).toEqual({ valid: true, minutes: 10 });
  });

  it("happy path: a decimal value is valid (no integer-only restriction specified)", () => {
    expect(validateMaxDetourMinutes("7.5")).toEqual({ valid: true, minutes: 7.5 });
  });

  it("edge case: empty input is invalid with the exact ux-spec copy", () => {
    expect(validateMaxDetourMinutes("")).toEqual({
      valid: false,
      error: "Enter a maximum detour time in minutes.",
    });
  });

  it("edge case: whitespace-only input is treated as empty", () => {
    expect(validateMaxDetourMinutes("   ")).toEqual({
      valid: false,
      error: "Enter a maximum detour time in minutes.",
    });
  });

  it("invalid input: zero is rejected with the exact ux-spec copy", () => {
    expect(validateMaxDetourMinutes("0")).toEqual({
      valid: false,
      error: "Enter a number greater than 0.",
    });
  });

  it("invalid input: a negative number is rejected", () => {
    expect(validateMaxDetourMinutes("-5")).toEqual({
      valid: false,
      error: "Enter a number greater than 0.",
    });
  });

  it("invalid input: non-numeric text is rejected", () => {
    expect(validateMaxDetourMinutes("abc")).toEqual({
      valid: false,
      error: "Enter a number greater than 0.",
    });
  });

  it("invalid input: Infinity/NaN-producing input is rejected, not silently accepted", () => {
    expect(validateMaxDetourMinutes("Infinity").valid).toBe(false);
    expect(validateMaxDetourMinutes("NaN").valid).toBe(false);
  });

  describe("no upper bound (design.md section 1.3 -- explicit user decision, must never be enforced)", () => {
    it("accepts a large-but-ordinary value (500)", () => {
      expect(validateMaxDetourMinutes("500")).toEqual({ valid: true, minutes: 500 });
    });

    it("accepts a very large value (100000) exactly as dev tested, confirming no hidden ceiling", () => {
      expect(validateMaxDetourMinutes("100000")).toEqual({ valid: true, minutes: 100000 });
    });

    it("accepts an even larger value (10000000) -- QA's own independent check beyond dev's tested ceiling", () => {
      expect(validateMaxDetourMinutes("10000000")).toEqual({ valid: true, minutes: 10000000 });
    });

    it("accepts a value larger than a plausible 24-hour-minutes bound (e.g. 1e9) -- there must be no implicit sanity ceiling of any kind", () => {
      const result = validateMaxDetourMinutes("1000000000");
      expect(result.valid).toBe(true);
      expect(result.valid && result.minutes).toBe(1000000000);
    });
  });
});
