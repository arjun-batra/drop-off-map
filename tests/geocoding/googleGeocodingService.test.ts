import { describe, expect, it } from "vitest";
import { GeocodingProviderError } from "../../src/geocoding/errors";
import { createGoogleGeocodingService } from "../../src/geocoding/googleGeocodingService";

function fakeFetch(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  return async () => response;
}

describe("createGoogleGeocodingService -- FR-003, FR-015, provider integration", () => {
  describe("resolve() -- forward geocode", () => {
    it("happy path: maps Google's OK response into GeoResult[]", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({
          ok: true,
          status: 200,
          json: async () => ({
            status: "OK",
            results: [
              {
                formatted_address: "123 Main St, Toronto, ON",
                place_id: "place-1",
                geometry: { location: { lat: 43.65, lng: -79.38 } },
              },
            ],
          }),
        }),
      });

      const results = await service.resolve("123 Main St");
      expect(results).toEqual([{ lat: 43.65, lng: -79.38, label: "123 Main St, Toronto, ON", placeId: "place-1" }]);
    });

    it("invalid address (FR-003): ZERO_RESULTS returns an empty array, not a throw", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }),
      });

      const results = await service.resolve("asdkfjhaslkdjfh nonsense address");
      expect(results).toEqual([]);
    });

    it("empty/whitespace-only query short-circuits to an empty array without calling the provider", async () => {
      let called = false;
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: async () => {
          called = true;
          return { ok: true, status: 200, json: async () => ({ status: "OK", results: [] }) };
        },
      });

      const results = await service.resolve("   ");
      expect(results).toEqual([]);
      expect(called).toBe(false);
    });

    it("invalid input: non-OK/non-ZERO_RESULTS provider status throws GeocodingProviderError", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "bad-key",
        fetchImpl: fakeFetch({
          ok: true,
          status: 200,
          json: async () => ({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }),
        }),
      });

      await expect(service.resolve("123 Main St")).rejects.toBeInstanceOf(GeocodingProviderError);
      await expect(service.resolve("123 Main St")).rejects.toMatchObject({ providerStatus: "REQUEST_DENIED" });
    });

    it("edge case: non-OK HTTP status throws GeocodingProviderError", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({ ok: false, status: 500, json: async () => ({}) }),
      });

      await expect(service.resolve("123 Main St")).rejects.toBeInstanceOf(GeocodingProviderError);
    });

    it("edge case: a network-level failure (fetch throws) is wrapped in GeocodingProviderError", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: async () => {
          throw new Error("network down");
        },
      });

      await expect(service.resolve("123 Main St")).rejects.toBeInstanceOf(GeocodingProviderError);
    });

    it("edge case: malformed response body (no status field) throws GeocodingProviderError", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => ({ unexpected: "shape" }) }),
      });

      await expect(service.resolve("123 Main St")).rejects.toBeInstanceOf(GeocodingProviderError);
    });

    it("never leaks apiKey in the request URL parameters object improperly (key sent, but only to the provider call)", async () => {
      let capturedUrl = "";
      const service = createGoogleGeocodingService({
        apiKey: "secret-key-value",
        fetchImpl: async (url: string) => {
          capturedUrl = url;
          return { ok: true, status: 200, json: async () => ({ status: "OK", results: [] }) };
        },
      });
      await service.resolve("123 Main St");
      expect(capturedUrl).toContain("key=secret-key-value");
    });
  });

  describe("reverseGeocode() -- 'use my current location', FR-015", () => {
    it("happy path: returns the formatted address label", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({
          ok: true,
          status: 200,
          json: async () => ({
            status: "OK",
            results: [
              {
                formatted_address: "Near Yonge & Bloor, Toronto, ON",
                geometry: { location: { lat: 43.67, lng: -79.39 } },
              },
            ],
          }),
        }),
      });

      const label = await service.reverseGeocode({ lat: 43.67, lng: -79.39 });
      expect(label).toBe("Near Yonge & Bloor, Toronto, ON");
    });

    it("ZERO_RESULTS throws a GeocodingProviderError tagged ZERO_RESULTS (caller treats this as a normal empty result)", async () => {
      const service = createGoogleGeocodingService({
        apiKey: "test-key",
        fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }),
      });

      await expect(service.reverseGeocode({ lat: 0, lng: 0 })).rejects.toMatchObject({
        providerStatus: "ZERO_RESULTS",
      });
    });
  });
});
