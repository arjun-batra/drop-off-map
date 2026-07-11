import { describe, expect, it } from "vitest";
import { buildSessionCookieHeader, parseCookies, shouldUseSecureCookie } from "../../src/auth/cookies";

describe("parseCookies", () => {
  it("parses a single cookie", () => {
    expect(parseCookies("dropspot_session=abc123")).toEqual({ dropspot_session: "abc123" });
  });

  it("parses multiple cookies separated by semicolons", () => {
    expect(parseCookies("a=1; dropspot_session=abc123; b=2")).toEqual({
      a: "1",
      dropspot_session: "abc123",
      b: "2",
    });
  });

  it("URL-decodes cookie values", () => {
    expect(parseCookies("dropspot_session=abc%20123")).toEqual({ dropspot_session: "abc 123" });
  });

  it("returns an empty object for undefined/null/empty header", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("ignores malformed entries without an '='", () => {
    expect(parseCookies("garbage; dropspot_session=abc123")).toEqual({ dropspot_session: "abc123" });
  });
});

describe("shouldUseSecureCookie", () => {
  it("is true for production", () => {
    expect(shouldUseSecureCookie("production")).toBe(true);
  });

  it("is true for preview", () => {
    expect(shouldUseSecureCookie("preview")).toBe(true);
  });

  it("is false for development / unset (local http dev)", () => {
    expect(shouldUseSecureCookie("development")).toBe(false);
    expect(shouldUseSecureCookie(undefined)).toBe(false);
  });
});

describe("buildSessionCookieHeader", () => {
  it("includes HttpOnly, SameSite=Lax, and Path=/", () => {
    const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: false, maxAgeSeconds: 3600 });
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("dropspot_session=tok123");
  });

  it("omits Secure when secure=false (local http dev)", () => {
    const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: false, maxAgeSeconds: 3600 });
    expect(header).not.toContain("Secure");
  });

  it("includes Secure when secure=true (production/preview)", () => {
    const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: true, maxAgeSeconds: 3600 });
    expect(header).toContain("Secure");
  });

  it("URL-encodes the token value", () => {
    const header = buildSessionCookieHeader("dropspot_session", "tok with space", {
      secure: false,
      maxAgeSeconds: 3600,
    });
    expect(header).toContain(encodeURIComponent("tok with space"));
  });

  describe("REV-002 -- Max-Age (defense-in-depth, mirrors the token's own signed expiry)", () => {
    it("includes Max-Age matching the configured maxAgeSeconds", () => {
      const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: false, maxAgeSeconds: 3600 });
      expect(header).toContain("Max-Age=3600");
    });

    it("configurability: reflects a changed maxAgeSeconds rather than a fixed value", () => {
      const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: false, maxAgeSeconds: 60 });
      expect(header).toContain("Max-Age=60");
      expect(header).not.toContain("Max-Age=3600");
    });

    it("floors a fractional maxAgeSeconds to a whole number of seconds", () => {
      const header = buildSessionCookieHeader("dropspot_session", "tok123", { secure: false, maxAgeSeconds: 60.9 });
      expect(header).toContain("Max-Age=60");
    });
  });
});
