import { describe, expect, it } from "vitest";
import { createSessionToken, isValidSessionToken } from "../../src/auth/session";

describe("session token (stateless, HMAC-based -- NFR-003 no server-side session store)", () => {
  it("is deterministic for a given password (no server-side state involved)", () => {
    const a = createSessionToken("pw-1");
    const b = createSessionToken("pw-1");
    expect(a).toBe(b);
  });

  it("produces different tokens for different passwords", () => {
    const a = createSessionToken("pw-1");
    const b = createSessionToken("pw-2");
    expect(a).not.toBe(b);
  });

  it("validates a token created with the same password", () => {
    const token = createSessionToken("correct-password");
    expect(isValidSessionToken(token, "correct-password")).toBe(true);
  });

  it("rejects a token if the configured password has since changed (rotation invalidates sessions)", () => {
    const token = createSessionToken("old-password");
    expect(isValidSessionToken(token, "new-password")).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(isValidSessionToken("", "correct-password")).toBe(false);
  });

  it("rejects a garbage token of the same length as a real one", () => {
    const real = createSessionToken("correct-password");
    const garbage = "0".repeat(real.length);
    expect(isValidSessionToken(garbage, "correct-password")).toBe(false);
  });

  it("rejects any token when no password is configured (null)", () => {
    const token = createSessionToken("whatever");
    expect(isValidSessionToken(token, null)).toBe(false);
  });
});
