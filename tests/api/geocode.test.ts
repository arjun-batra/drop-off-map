import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/geocode";
import { AuthGate } from "../../src/auth/authGate";
import { createSessionToken } from "../../src/auth/session";
import { createMock } from "../helpers/mockVercel";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function googleOk(results: Array<{ formatted_address: string; place_id?: string; lat: number; lng: number }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      results: results.map((r) => ({
        formatted_address: r.formatted_address,
        place_id: r.place_id,
        geometry: { location: { lat: r.lat, lng: r.lng } },
      })),
    }),
  };
}

function googleZeroResults() {
  return { ok: true, status: 200, json: async () => ({ status: "ZERO_RESULTS", results: [] }) };
}

function googleStatus(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, results: [] }) };
}

describe("GET /api/geocode -- FR-001, FR-003, FR-015, AuthGate wiring", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("AuthGate wiring -- the orchestrator's critical flag: first real protected business endpoint", () => {
    it("free_tier: no cookie needed, request reaches the provider and succeeds", async () => {
      applyEnv(validEnv({ APP_MODE: "free_tier" }));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(googleOk([{ formatted_address: "123 Main St, Toronto, ON", lat: 43.65, lng: -79.38 }])),
      );
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "123 Main St" } });
      await handler(req, res);
      expect(statusCode()).toBe(200);
      expect((jsonBody() as { results: unknown[] }).results).toHaveLength(1);
    });

    it("paid_tier, no cookie at all: 401 unauthorized, and the provider is NEVER called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(googleOk([]));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "123 Main St" } });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, wrong/garbage cookie: 401 unauthorized, provider never called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(googleOk([]));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { query: "123 Main St" },
        cookie: "dropspot_session=not-a-real-token",
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, valid session cookie: passes AuthGate and reaches the provider (200)", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(googleOk([{ formatted_address: "123 Main St, Toronto, ON", lat: 43.65, lng: -79.38 }])),
      );

      const token = createSessionToken("correct-password");
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { query: "123 Main St" },
        cookie: `dropspot_session=${token}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as { results: unknown[] }).results).toHaveLength(1);
    });

    it("a cookie valid under a previously-rotated password is rejected after rotation (401), provider not called", async () => {
      // Belt-and-suspenders re-check of AuthGate's own rotation behavior, now
      // exercised through the real protected endpoint rather than only the
      // AuthGate unit itself.
      const staleToken = createSessionToken("old-password");
      applyEnv(validPaidTierEnv("new-password"));
      const fetchSpy = vi.fn().mockResolvedValue(googleOk([]));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode } = createMock({
        method: "GET",
        query: { query: "123 Main St" },
        cookie: `dropspot_session=${staleToken}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("AuthGate is checked even before the query-shape (query too short) is evaluated", async () => {
      // Ordering check: unauthorized requests should never leak validation
      // details about the query either.
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(googleOk([]));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "ab" } });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
    });
  });

  describe("forward geocode (?query=) -- FR-003, FR-015", () => {
    it("happy path: returns resolved results", async () => {
      applyEnv(validEnv());
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          googleOk([{ formatted_address: "456 Bay St, Toronto, ON", lat: 43.66, lng: -79.38, place_id: "abc" }]),
        ),
      );
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "456 Bay St" } });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect(jsonBody()).toEqual({
        results: [{ lat: 43.66, lng: -79.38, label: "456 Bay St, Toronto, ON", placeId: "abc" }],
      });
    });

    it("invalid address (FR-003): ZERO_RESULTS returns 200 with an empty array, not an error", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleZeroResults()));
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "asdkfjaslkdfj" } });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect(jsonBody()).toEqual({ results: [] });
    });

    it("edge case: query under MIN_QUERY_LENGTH (3 chars) returns 400 query_too_short", async () => {
      applyEnv(validEnv());
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "ab" } });
      await handler(req, res);

      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("query_too_short");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a query of whitespace only is treated as too short (trimmed before length check)", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "   " } });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("query_too_short");
    });

    it("invalid input: provider error status (e.g. REQUEST_DENIED) surfaces as 502 provider_error", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleStatus("REQUEST_DENIED", "The provided API key is invalid.")));
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "123 Main St" } });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      expect((jsonBody() as { error: string }).error).toBe("provider_error");
    });

    it("network failure calling the provider surfaces as 502 provider_error, not a crash", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "123 Main St" } });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      expect((jsonBody() as { error: string }).error).toBe("provider_error");
    });
  });

  describe("reverse geocode (?lat=&lng=) -- 'use my current location', FR-015", () => {
    it("happy path: returns a single labeled result", async () => {
      applyEnv(validEnv());
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(googleOk([{ formatted_address: "Near Yonge & Bloor, Toronto, ON", lat: 43.67, lng: -79.39 }])),
      );
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { lat: "43.67", lng: "-79.39" },
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect(jsonBody()).toEqual({
        results: [{ lat: 43.67, lng: -79.39, label: "Near Yonge & Bloor, Toronto, ON" }],
      });
    });

    it("ZERO_RESULTS on reverse geocode returns 200 empty array (not an error)", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleZeroResults()));
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { lat: "0", lng: "0" },
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect(jsonBody()).toEqual({ results: [] });
    });

    it("invalid point: non-numeric lat/lng returns 400 invalid_point", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { lat: "not-a-number", lng: "-79.39" },
      });
      await handler(req, res);

      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_point");
    });
  });

  describe("request shape / method handling", () => {
    it("missing both query and lat/lng returns 400 missing_query_or_point", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET" });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("missing_query_or_point");
    });

    it("rejects non-GET methods with 405", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "POST" });
      await handler(req, res);
      expect(statusCode()).toBe(405);
      expect((jsonBody() as { error: string }).error).toBe("method_not_allowed");
    });

    it("config-load failure (missing MAP_API_KEY) returns 500 config_error, checked before AuthGate", async () => {
      const env = validPaidTierEnv("correct-password");
      delete env.MAP_API_KEY;
      applyEnv(env);
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { query: "123 Main St" } });
      await handler(req, res);
      expect(statusCode()).toBe(500);
      expect((jsonBody() as { error: string }).error).toBe("config_error");
    });
  });
});

describe("sanity: AuthGate.check itself still gates as expected (regression guard for this suite's mocks)", () => {
  it("paid_tier blocks with no cookie", () => {
    expect(
      AuthGate.check({ headers: {} }, { appMode: "paid_tier", paidTierAccessPassword: "x" }),
    ).toBe(false);
  });
});
