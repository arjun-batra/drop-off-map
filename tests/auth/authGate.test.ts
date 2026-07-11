import { describe, expect, it } from "vitest";
import { AuthGate } from "../../src/auth/authGate";
import { createSessionToken } from "../../src/auth/session";
import { validSessionToken } from "../helpers/sessionToken";

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
      const token = validSessionToken(password);
      const allowed = AuthGate.check(
        { headers: { cookie: `dropspot_session=${token}` } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(true);
    });

    it("blocks a session cookie that was valid for a since-rotated password", () => {
      const staleToken = validSessionToken("old-password");
      const allowed = AuthGate.check(
        { headers: { cookie: `dropspot_session=${staleToken}` } },
        { appMode: "paid_tier", paidTierAccessPassword: "new-password" },
      );
      expect(allowed).toBe(false);
    });

    it("handles an array-valued cookie header (uses the first entry)", () => {
      const token = validSessionToken(password);
      const allowed = AuthGate.check(
        { headers: { cookie: [`dropspot_session=${token}`] } },
        { appMode: "paid_tier", paidTierAccessPassword: password },
      );
      expect(allowed).toBe(true);
    });

    describe("REV-002 -- session expiry, via AuthGate's injectable clock", () => {
      it("passes for a token that has not yet expired", () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const token = createSessionToken(password, nowSeconds + 10);
        const allowed = AuthGate.check(
          { headers: { cookie: `dropspot_session=${token}` } },
          { appMode: "paid_tier", paidTierAccessPassword: password },
          nowSeconds * 1000,
        );
        expect(allowed).toBe(true);
      });

      it("blocks once the injected clock passes the token's expiry (session genuinely expires)", () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const token = createSessionToken(password, nowSeconds + 10);
        const allowedAfterExpiry = AuthGate.check(
          { headers: { cookie: `dropspot_session=${token}` } },
          { appMode: "paid_tier", paidTierAccessPassword: password },
          (nowSeconds + 11) * 1000,
        );
        expect(allowedAfterExpiry).toBe(false);
      });

      it("defaults to Date.now() when no clock is injected (production call sites are unaffected)", () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiredToken = createSessionToken(password, nowSeconds - 1000);
        const allowed = AuthGate.check(
          { headers: { cookie: `dropspot_session=${expiredToken}` } },
          { appMode: "paid_tier", paidTierAccessPassword: password },
        );
        expect(allowed).toBe(false);
      });
    });
  });
});
