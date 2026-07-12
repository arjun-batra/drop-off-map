import type { LatLng } from "../geo/types.js";
import { fetchWithTimeout, ProviderTimeoutError, type TimeoutAwareFetch } from "../http/fetchWithTimeout.js";
import { GeocodingProviderError } from "./errors.js";
import type { GeocodingService, GeoResult } from "./types.js";

const GOOGLE_GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

type FetchLike = TimeoutAwareFetch;

interface GoogleGeocodeResponseResult {
  formatted_address: string;
  place_id?: string;
  geometry: { location: { lat: number; lng: number } };
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: GoogleGeocodeResponseResult[];
}

export interface GoogleGeocodingServiceOptions {
  /** design.md section 7's MAP_API_KEY -- server-side only, never sent to the browser. */
  apiKey: string;
  /** Injectable for testability; defaults to the global fetch (Node 18+/Vercel runtime). */
  fetchImpl?: FetchLike;
  /** Injectable so tests don't hit the real Google endpoint. */
  endpoint?: string;
  /**
   * design.md section 6.3/7's REQUEST_TIMEOUT_MS -- hard per-call timeout
   * (INC-7/NFR-004). Optional so existing unit tests that construct this
   * service without a timeout keep working unmodified (see
   * fetchWithTimeout.ts); every production caller (api/geocode.ts,
   * api/drop-off-search.ts) always supplies `config.requestTimeoutMs`.
   */
  timeoutMs?: number;
}

function isGoogleGeocodeResponse(body: unknown): body is GoogleGeocodeResponse {
  return typeof body === "object" && body !== null && "status" in body;
}

async function callGoogleGeocodeApi(
  fetchImpl: FetchLike,
  endpoint: string,
  params: Record<string, string>,
  timeoutMs: number | undefined,
): Promise<GoogleGeocodeResponse> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await fetchWithTimeout(fetchImpl, url.toString(), timeoutMs);
  } catch (err) {
    if (err instanceof ProviderTimeoutError) {
      throw new GeocodingProviderError("TIMEOUT", err.message);
    }
    throw new GeocodingProviderError("NETWORK_ERROR", err instanceof Error ? err.message : "Network request failed.");
  }

  if (!res.ok) {
    throw new GeocodingProviderError("HTTP_ERROR", `Geocoding provider HTTP ${res.status}.`);
  }

  const body = await res.json();
  if (!isGoogleGeocodeResponse(body)) {
    throw new GeocodingProviderError("MALFORMED_RESPONSE", "Geocoding provider returned an unexpected response shape.");
  }

  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new GeocodingProviderError(body.status, body.error_message);
  }

  return body;
}

function toGeoResult(result: GoogleGeocodeResponseResult): GeoResult {
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    label: result.formatted_address,
    placeId: result.place_id,
  };
}

/**
 * Implements `GeocodingService` (design.md section 5.1) against Google Maps
 * Platform's Geocoding API (design.md section 3's recommended provider).
 * Server-side only -- see api/geocode.ts, the sole caller. `apiKey` must
 * never reach the browser.
 */
export function createGoogleGeocodingService(options: GoogleGeocodingServiceOptions): GeocodingService {
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const endpoint = options.endpoint ?? GOOGLE_GEOCODE_ENDPOINT;

  return {
    async resolve(query: string): Promise<GeoResult[]> {
      const trimmed = query.trim();
      if (trimmed === "") return [];

      const body = await callGoogleGeocodeApi(
        fetchImpl,
        endpoint,
        { address: trimmed, key: options.apiKey },
        options.timeoutMs,
      );

      if (body.status === "ZERO_RESULTS") return [];
      return body.results.map(toGeoResult);
    },

    async reverseGeocode(point: LatLng): Promise<string> {
      const body = await callGoogleGeocodeApi(
        fetchImpl,
        endpoint,
        { latlng: `${point.lat},${point.lng}`, key: options.apiKey },
        options.timeoutMs,
      );

      const [first] = body.results;
      if (body.status === "ZERO_RESULTS" || !first) {
        throw new GeocodingProviderError("ZERO_RESULTS", "No address could be matched to that location.");
      }
      return first.formatted_address;
    },
  };
}
