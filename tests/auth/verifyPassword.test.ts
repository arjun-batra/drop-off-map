import { describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/auth/verifyPassword";

describe("verifyPassword", () => {
  it("returns true for a matching password", () => {
    expect(verifyPassword("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for a non-matching password", () => {
    expect(verifyPassword("wrong", "hunter2")).toBe(false);
  });

  it("returns false when submitted is empty", () => {
    expect(verifyPassword("", "hunter2")).toBe(false);
  });

  it("returns false when configuredPassword is null (no password set)", () => {
    expect(verifyPassword("hunter2", null)).toBe(false);
  });

  it("returns false when both are empty", () => {
    expect(verifyPassword("", null)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifyPassword("Hunter2", "hunter2")).toBe(false);
  });

  it("does not match on a substring/prefix of the real password", () => {
    expect(verifyPassword("hunter", "hunter2")).toBe(false);
  });
});
