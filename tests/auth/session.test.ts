import { describe, expect, it } from "vitest";
import { createSessionToken, isValidSessionToken } from "../../src/auth/session";

// REV-002 (INC-8): tokens now embed a signed expiry
// (`${expiresAtEpochSeconds}.${hmac}`), so every call site below passes an
// explicit expiry rather than relying on a single-argument call (which is no
// longer valid -- `createSessionToken`'s second argument is required).
const NOW_SECONDS = Math.floor(Date.now() / 1000);
const ONE_HOUR_FROM_NOW = NOW_SECONDS + 3600;

describe("session token (stateless, HMAC-based -- NFR-003 no server-side session store)", () => {
  it("is deterministic for a given password + expiry (no server-side state involved)", () => {
    const a = createSessionToken("pw-1", ONE_HOUR_FROM_NOW);
    const b = createSessionToken("pw-1", ONE_HOUR_FROM_NOW);
    expect(a).toBe(b);
  });

  it("produces different tokens for different passwords (same expiry)", () => {
    const a = createSessionToken("pw-1", ONE_HOUR_FROM_NOW);
    const b = createSessionToken("pw-2", ONE_HOUR_FROM_NOW);
    expect(a).not.toBe(b);
  });

  it("produces different tokens for different expiries (same password)", () => {
    const a = createSessionToken("pw-1", ONE_HOUR_FROM_NOW);
    const b = createSessionToken("pw-1", ONE_HOUR_FROM_NOW + 60);
    expect(a).not.toBe(b);
  });

  it("validates a token created with the same password, not yet expired", () => {
    const token = createSessionToken("correct-password", ONE_HOUR_FROM_NOW);
    expect(isValidSessionToken(token, "correct-password", NOW_SECONDS * 1000)).toBe(true);
  });

  it("rejects a token if the configured password has since changed (rotation invalidates sessions)", () => {
    const token = createSessionToken("old-password", ONE_HOUR_FROM_NOW);
    expect(isValidSessionToken(token, "new-password", NOW_SECONDS * 1000)).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(isValidSessionToken("", "correct-password")).toBe(false);
  });

  it("rejects a garbage token of the same length as a real one", () => {
    const real = createSessionToken("correct-password", ONE_HOUR_FROM_NOW);
    const garbage = "0".repeat(real.length);
    expect(isValidSessionToken(garbage, "correct-password")).toBe(false);
  });

  it("rejects any token when no password is configured (null)", () => {
    const token = createSessionToken("whatever", ONE_HOUR_FROM_NOW);
    expect(isValidSessionToken(token, null)).toBe(false);
  });

  describe("REV-002 -- signed expiry", () => {
    it("accepts a token strictly before its expiry", () => {
      const expiresAt = NOW_SECONDS + 100;
      const token = createSessionToken("correct-password", expiresAt);
      // 1 second before expiry, in ms.
      const now = (expiresAt - 1) * 1000;
      expect(isValidSessionToken(token, "correct-password", now)).toBe(true);
    });

    it("rejects a token at the exact boundary (now === expiresAt), strict less-than", () => {
      const expiresAt = NOW_SECONDS + 100;
      const token = createSessionToken("correct-password", expiresAt);
      const now = expiresAt * 1000;
      expect(isValidSessionToken(token, "correct-password", now)).toBe(false);
    });

    it("rejects a token 1 second past its expiry", () => {
      const expiresAt = NOW_SECONDS + 100;
      const token = createSessionToken("correct-password", expiresAt);
      const now = (expiresAt + 1) * 1000;
      expect(isValidSessionToken(token, "correct-password", now)).toBe(false);
    });

    it("rejects a token long past its expiry", () => {
      const expiresAt = NOW_SECONDS - 3600;
      const token = createSessionToken("correct-password", expiresAt);
      expect(isValidSessionToken(token, "correct-password", NOW_SECONDS * 1000)).toBe(false);
    });

    it("rejects a token whose plaintext expiry has been tampered with to extend it (signature covers the expiry)", () => {
      const originalExpiry = NOW_SECONDS - 10; // already expired
      const token = createSessionToken("correct-password", originalExpiry);
      const separatorIndex = token.indexOf(".");
      const hmacPart = token.slice(separatorIndex + 1);
      // Attacker edits the plaintext expiry forward in time, keeping the
      // original (now-mismatched) signature.
      const tamperedExpiry = NOW_SECONDS + 3600;
      const tamperedToken = `${tamperedExpiry}.${hmacPart}`;
      expect(isValidSessionToken(tamperedToken, "correct-password", NOW_SECONDS * 1000)).toBe(false);
    });

    it("rejects a malformed token with no expiry/separator at all (old single-value format fails closed, not open)", () => {
      expect(isValidSessionToken("just-some-opaque-string", "correct-password")).toBe(false);
    });

    it("rejects a token with a non-numeric expiry segment", () => {
      expect(isValidSessionToken("not-a-number.somehmac", "correct-password")).toBe(false);
    });
  });
});
