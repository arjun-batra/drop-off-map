import { describe, expect, it, vi } from "vitest";
import { createGoogleDistanceMatrixService } from "../../src/routing/googleDistanceMatrixService";
import { RoutingProviderError } from "../../src/routing/errors";

const START = { lat: 43.6532, lng: -79.3832 };
const CANDIDATES = [
  { lat: 43.7, lng: -79.4 },
  { lat: 43.71, lng: -79.41 },
];
const DEST = { lat: 43.8, lng: -79.5 };

function matrixOk(rows: Array<Array<{ status?: string; duration?: number; durationInTraffic?: number }>>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      rows: rows.map((row) => ({
        elements: row.map((el) => ({
          status: el.status ?? "OK",
          ...(el.duration !== undefined ? { duration: { value: el.duration } } : {}),
          ...(el.durationInTraffic !== undefined ? { duration_in_traffic: { value: el.durationInTraffic } } : {}),
        })),
      })),
    }),
  };
}

function matrixStatus(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, rows: [] }) };
}

describe("createGoogleDistanceMatrixService -- design.md section 4.3 step 6, FR-007", () => {
  it("issues the 1xN 'to' shape request with departure_time and mode=driving", async () => {
    const fixedNow = new Date("2026-07-11T12:00:00Z");
    const fetchSpy = vi.fn(async (_url: string) => matrixOk([[{ duration: 300 }, { duration: 300 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy, now: () => fixedNow });

    await service.getDurationsMinutes([START], CANDIDATES, false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.searchParams.get("mode")).toBe("driving");
    expect(url.searchParams.get("departure_time")).toBe(String(Math.floor(fixedNow.getTime() / 1000)));
    expect(url.searchParams.get("origins")).toBe("43.6532,-79.3832");
    expect(url.searchParams.get("destinations")).toBe("43.7,-79.4|43.71,-79.41");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("issues the Nx1 'from' shape request the same way", async () => {
    const fetchSpy = vi.fn(async (_url: string) => matrixOk([[{ duration: 300 }], [{ duration: 300 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await service.getDurationsMinutes(CANDIDATES, [DEST], false);

    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.searchParams.get("origins")).toBe("43.7,-79.4|43.71,-79.41");
    expect(url.searchParams.get("destinations")).toBe("43.8,-79.5");
  });

  it("prefers duration_in_traffic over the static duration when both are present", async () => {
    const fetchSpy = vi.fn(async () => matrixOk([[{ duration: 600, durationInTraffic: 900 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDurationsMinutes([START], [CANDIDATES[0]!], false);

    expect(result[0]![0]).toBe(15);
    expect(result[0]![0]).not.toBe(10);
  });

  it("falls back to the static duration when duration_in_traffic is absent", async () => {
    const fetchSpy = vi.fn(async () => matrixOk([[{ duration: 600 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDurationsMinutes([START], [CANDIDATES[0]!], false);

    expect(result[0]![0]).toBe(10);
  });

  it("a per-element non-OK status (e.g. ZERO_RESULTS) resolves to null for that element, not an error", async () => {
    const fetchSpy = vi.fn(async () => matrixOk([[{ status: "ZERO_RESULTS" }, { duration: 300 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    const result = await service.getDurationsMinutes([START], CANDIDATES, false);

    expect(result[0]![0]).toBeNull();
    expect(result[0]![1]).toBe(5);
  });

  it("a whole-request non-OK status (e.g. REQUEST_DENIED) throws RoutingProviderError, distinct from a per-element failure", async () => {
    const fetchSpy = vi.fn(async () => matrixStatus("REQUEST_DENIED", "The provided API key is invalid."));
    const service = createGoogleDistanceMatrixService({ apiKey: "bad-key", fetchImpl: fetchSpy });

    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow(RoutingProviderError);
    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow("The provided API key is invalid.");
  });

  it("OVER_QUERY_LIMIT (a whole-request status) also throws rather than being treated as a per-element issue", async () => {
    const fetchSpy = vi.fn(async () => matrixStatus("OVER_QUERY_LIMIT"));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow(RoutingProviderError);
  });

  it("a network failure surfaces as RoutingProviderError, not an unhandled rejection", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow(RoutingProviderError);
  });

  it("a malformed response shape (missing status/rows) throws RoutingProviderError rather than crashing", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ notStatus: true }) }));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow(RoutingProviderError);
  });

  it("an HTTP-level failure (non-ok response) throws RoutingProviderError", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

    await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toThrow(RoutingProviderError);
  });

  it("the configured apiKey is forwarded, never a hardcoded/other value", async () => {
    const fetchSpy = vi.fn(async (_url: string) => matrixOk([[{ duration: 300 }]]));
    const service = createGoogleDistanceMatrixService({ apiKey: "my-specific-configured-key", fetchImpl: fetchSpy });

    await service.getDurationsMinutes([START], [CANDIDATES[0]!], false);

    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.searchParams.get("key")).toBe("my-specific-configured-key");
  });

  describe("REQUEST_TIMEOUT_MS enforcement (NFR-004, INC-7)", () => {
    it("a hung provider call is genuinely aborted at timeoutMs and surfaces as RoutingProviderError('TIMEOUT')", async () => {
      const fetchSpy = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      const service = createGoogleDistanceMatrixService({
        apiKey: "test-key",
        fetchImpl: fetchSpy as never,
        timeoutMs: 20,
      });

      await expect(service.getDurationsMinutes([START], CANDIDATES, false)).rejects.toMatchObject({
        providerStatus: "TIMEOUT",
      });
    });

    it("omitting timeoutMs is a passthrough: a normal call still resolves", async () => {
      const fetchSpy = vi.fn(async () => matrixOk([[{ duration: 300 }]]));
      const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

      await expect(service.getDurationsMinutes([START], [CANDIDATES[0]!], false)).resolves.toEqual([[5]]);
    });
  });

  describe("FR-018/design.md section 4.3a (INC-13): `avoid=tolls` parameter", () => {
    it("avoidTolls=true sets avoid=tolls on the Distance Matrix request", async () => {
      const fetchSpy = vi.fn(async (_url: string) => matrixOk([[{ duration: 300 }]]));
      const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

      await service.getDurationsMinutes([START], [CANDIDATES[0]!], true);

      const url = new URL(fetchSpy.mock.calls[0]![0] as string);
      expect(url.searchParams.get("avoid")).toBe("tolls");
    });

    it("avoidTolls=false omits the avoid parameter entirely", async () => {
      const fetchSpy = vi.fn(async (_url: string) => matrixOk([[{ duration: 300 }]]));
      const service = createGoogleDistanceMatrixService({ apiKey: "test-key", fetchImpl: fetchSpy });

      await service.getDurationsMinutes([START], [CANDIDATES[0]!], false);

      const url = new URL(fetchSpy.mock.calls[0]![0] as string);
      expect(url.searchParams.has("avoid")).toBe(false);
    });
  });
});
