import { describe, expect, it, vi } from "vitest";
import { createGoogleRoutingService } from "../../src/routing/googleRoutingService";
import { RoutingProviderError } from "../../src/routing/errors";

const START = { lat: 43.6532, lng: -79.3832 };
const DEST = { lat: 43.7, lng: -79.4 };

// Encodes to a single point (0,0) -- content of the polyline itself is not
// under test here, only that duration selection/departure_time behavior is
// correct; polyline.test.ts covers decoding correctness directly.
const DUMMY_POLYLINE = "??";

function directionsOk(overrides: { duration: number; durationInTraffic?: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      routes: [
        {
          legs: [
            {
              duration: { value: overrides.duration },
              ...(overrides.durationInTraffic !== undefined
                ? { duration_in_traffic: { value: overrides.durationInTraffic } }
                : {}),
            },
          ],
          overview_polyline: { points: DUMMY_POLYLINE },
        },
      ],
    }),
  };
}

function directionsStatus(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, routes: [] }) };
}

describe("createGoogleRoutingService -- FR-006a, FR-007 (live traffic)", () => {
  it("FR-007: every request includes departure_time (unix seconds) and mode=driving -- the live-traffic parameter is genuinely sent", async () => {
    const fixedNow = new Date("2026-07-11T12:00:00Z");
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600 }));
    const service = createGoogleRoutingService({
      apiKey: "test-key",
      fetchImpl: fetchSpy,
      now: () => fixedNow,
    });

    await service.getDirectRoute(START, DEST);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("mode")).toBe("driving");
    expect(calledUrl.searchParams.get("departure_time")).toBe(
      String(Math.floor(fixedNow.getTime() / 1000)),
    );
    expect(calledUrl.searchParams.get("origin")).toBe("43.6532,-79.3832");
    expect(calledUrl.searchParams.get("destination")).toBe("43.7,-79.4");
    expect(calledUrl.searchParams.get("key")).toBe("test-key");
  });

  it("FR-007: departure_time changes with the injected clock -- not a fixed/frozen literal", async () => {
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600 }));
    const laterDate = new Date("2030-01-01T00:00:00Z");
    const service = createGoogleRoutingService({
      apiKey: "test-key",
      fetchImpl: fetchSpy,
      now: () => laterDate,
    });

    await service.getDirectRoute(START, DEST);

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("departure_time")).toBe(
      String(Math.floor(laterDate.getTime() / 1000)),
    );
  });

  it("FR-007: prefers duration_in_traffic over the static duration when both are present, and the values are meaningfully different", async () => {
    // 900s (15 min) traffic-aware vs 600s (10 min) static -- confirms live
    // traffic actually changes the returned value, not just structurally present.
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600, durationInTraffic: 900 }));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDirectRoute(START, DEST);

    expect(result.durationMinutes).toBe(15);
    expect(result.durationMinutes).not.toBe(10); // the static-duration value, must NOT be what's returned
  });

  it("falls back to the static duration when duration_in_traffic is absent, rather than throwing", async () => {
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600 }));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDirectRoute(START, DEST);

    expect(result.durationMinutes).toBe(10);
  });

  it("decodes the route polyline into the returned result", async () => {
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600 }));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDirectRoute(START, DEST);

    expect(result.polyline).toEqual([{ lat: 0, lng: 0 }]);
  });

  it("a non-OK provider status (e.g. REQUEST_DENIED) throws RoutingProviderError with the provider's detail intact", async () => {
    const fetchSpy = vi.fn(async () => directionsStatus("REQUEST_DENIED", "The provided API key is invalid."));
    const service = createGoogleRoutingService({ apiKey: "bad-key", fetchImpl: fetchSpy });

    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow(RoutingProviderError);
    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow("The provided API key is invalid.");
  });

  it("ZERO_RESULTS (no drivable route) is treated as an error, unlike geocoding's ZERO_RESULTS", async () => {
    const fetchSpy = vi.fn(async () => directionsStatus("ZERO_RESULTS"));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow(RoutingProviderError);
  });

  it("a network failure surfaces as RoutingProviderError, not an unhandled rejection", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow(RoutingProviderError);
  });

  it("a malformed response shape (missing routes/legs) throws RoutingProviderError rather than crashing", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ notStatus: true }) }));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow(RoutingProviderError);
  });

  it("an HTTP-level failure (non-ok response) throws RoutingProviderError", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const service = createGoogleRoutingService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDirectRoute(START, DEST)).rejects.toThrow(RoutingProviderError);
  });

  it("the configured apiKey is forwarded in the request, never a hardcoded/other value", async () => {
    const fetchSpy = vi.fn(async () => directionsOk({ duration: 600 }));
    const service = createGoogleRoutingService({ apiKey: "my-specific-configured-key", fetchImpl: fetchSpy });

    await service.getDirectRoute(START, DEST);

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("key")).toBe("my-specific-configured-key");
  });
});
