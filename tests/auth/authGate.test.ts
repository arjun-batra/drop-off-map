import { describe, expect, it } from "vitest";
import { AuthGate } from "../../src/auth/authGate";
import { createSessionToken } from "../../src/auth/session";

describe("AuthGate.check -- FR-016/FR-017 binary, app-wide gate", () => {
  describe("free_tier (NFR-002: no login required for baseline use)", () => {
    it("always passes with no cookie at all", () => {
      const allowed = AuthGate.check(
        { headers: {} },
        { appMode: "free_tier", paidTierAccessPassword: null },
      );
      expect(allowed).toBe(true);
    });

    it("always passes even with a garbage cookie present", () => {
      const allowed = AuthGate.check(
        { headers: { cookie: "dropspot_session=garbage" } },
        { appMode: "free_tier", paidTierAccessPassword: null },
      );
      expect(allowed).toBe(true);
    });
  });

  describe("paid_tier", () => {
    const password = "the-password";

    it("blocks when no cookie header is present", () => {
      const allowed = AuthGate.check(
        { headers: {} },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(false);
    });

    it("blocks when the cookie header exists but has no session cookie", () => {
      const allowed = AuthGate.check(
        { headers: { cookie: "unrelated=1" } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(false);
    });

    it("blocks when the session cookie value is wrong/forged", () => {
      const allowed = AuthGate.check(
        { headers: { cookie: "dropspot_session=not-a-real-token" } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(false);
    });

    it("passes with a valid session cookie matching the configured password", () => {
      const token = createSessionToken(password);
      const allowed = AuthGate.check(
        { headers: { cookie: `dropspot_session=${token}` } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(true);
    });

    it("blocks a session cookie that was valid for a since-rotated password", () => {
      const staleToken = createSessionToken("old-password");
      const allowed = AuthGate.check(
        { headers: { cookie: `dropspot_session=${staleToken}` } },
        { appMode: "paid_tier", paidTierAccessPassword: "new-password" },
      );
      expect(allowed).toBe(false);
    });

    it("handles an array-valued cookie header (uses the first entry)", () => {
      const token = createSessionToken(password);
      const allowed = AuthGate.check(
        { headers: { cookie: [`dropspot_session=${token}`] } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(true);
    });
  });
});
