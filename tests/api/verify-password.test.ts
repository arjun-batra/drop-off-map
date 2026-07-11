import { afterEach, describe, expect, it } from "vitest";
import handler from "../../api/auth/verify-password";
import { AuthGate } from "../../src/auth/authGate";
import { createMock } from "../helpers/mockVercel";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function extractCookieValue(setCookieHeader: string | undefined): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = /dropspot_session=([^;]+)/.exec(setCookieHeader);
  return match ? decodeURIComponent(match[1]) : undefined;
}

describe("POST /api/auth/verify-password", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    delete process.env.VERCEL_ENV;
  });

  it("free_tier: returns 400 not_applicable (nothing to verify)", () => {
    applyEnv(validEnv({ APP_MODE: "free_tier" }));
    const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: { password: "anything" } });
    handler(req, res);
    expect(statusCode()).toBe(400);
    expect((jsonBody() as { error: string }).error).toBe("not_applicable");
  });

  it("paid_tier happy path: correct password returns 200 and sets a Set-Cookie session header", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, statusCode, jsonBody, header } = createMock({
      method: "POST",
      body: { password: "correct-password" },
    });
    handler(req, res);

    expect(statusCode()).toBe(200);
    expect(jsonBody()).toEqual({ ok: true });
    const setCookie = header("Set-Cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("paid_tier edge case: wrong password returns 401 invalid_password, no cookie set", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, statusCode, jsonBody, header } = createMock({
      method: "POST",
      body: { password: "wrong-password" },
    });
    handler(req, res);

    expect(statusCode()).toBe(401);
    expect((jsonBody() as { error: string }).error).toBe("invalid_password");
    expect(header("Set-Cookie")).toBeUndefined();
  });

  it("invalid input: missing password field in body returns 401 (treated as empty, not a crash)", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, statusCode } = createMock({ method: "POST", body: {} });
    handler(req, res);
    expect(statusCode()).toBe(401);
  });

  it("invalid input: non-string password field returns 401, not a crash", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, statusCode } = createMock({ method: "POST", body: { password: 12345 } });
    handler(req, res);
    expect(statusCode()).toBe(401);
  });

  it("does not set the Secure cookie flag locally (VERCEL_ENV unset)", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    delete process.env.VERCEL_ENV;
    const { req, res, header } = createMock({ method: "POST", body: { password: "correct-password" } });
    handler(req, res);
    expect(header("Set-Cookie")).not.toContain("Secure");
  });

  it("sets the Secure cookie flag when VERCEL_ENV=production", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    process.env.VERCEL_ENV = "production";
    const { req, res, header } = createMock({ method: "POST", body: { password: "correct-password" } });
    handler(req, res);
    expect(header("Set-Cookie")).toContain("Secure");
  });

  it("issues a session cookie that AuthGate.check() actually accepts on a follow-up request", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, header } = createMock({ method: "POST", body: { password: "correct-password" } });
    handler(req, res);

    const token = extractCookieValue(header("Set-Cookie"));
    expect(token).toBeTruthy();

    const allowed = AuthGate.check(
      { headers: { cookie: `dropspot_session=${token}` } },
      { appMode: "paid_tier", paidTierAccessPassword: "correct-password" },
    );
    expect(allowed).toBe(true);
  });

  it("a cookie issued before a password rotation is rejected by AuthGate after rotation", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, header } = createMock({ method: "POST", body: { password: "correct-password" } });
    handler(req, res);
    const token = extractCookieValue(header("Set-Cookie"));

    const allowedAfterRotation = AuthGate.check(
      { headers: { cookie: `dropspot_session=${token}` } },
      { appMode: "paid_tier", paidTierAccessPassword: "rotated-new-password" },
    );
    expect(allowedAfterRotation).toBe(false);
  });

  it("config error (missing MAP_API_KEY) surfaces as 500 config_error, not a crash", () => {
    const env = validPaidTierEnv("correct-password");
    delete env.MAP_API_KEY;
    applyEnv(env);
    const { req, res, statusCode, jsonBody } = createMock({
      method: "POST",
      body: { password: "correct-password" },
    });
    handler(req, res);
    expect(statusCode()).toBe(500);
    expect((jsonBody() as { error: string }).error).toBe("config_error");
  });

  it("rejects non-POST methods with 405", () => {
    applyEnv(validPaidTierEnv("correct-password"));
    const { req, res, statusCode } = createMock({ method: "GET" });
    handler(req, res);
    expect(statusCode()).toBe(405);
  });
});
