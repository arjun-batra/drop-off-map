import type { LatLng } from "../geo/types.js";
import { fetchWithTimeout, ProviderTimeoutError, type TimeoutAwareFetch } from "../http/fetchWithTimeout.js";
import { RoutingProviderError } from "./errors.js";

const GOOGLE_DISTANCE_MATRIX_ENDPOINT = "https://maps.googleapis.com/maps/api/distancematrix/json";

type FetchLike = TimeoutAwareFetch;

interface GoogleDistanceMatrixElement {
  status: string;
  duration?: { value: number };
  duration_in_traffic?: { value: number };
}

interface GoogleDistanceMatrixRow {
  elements: GoogleDistanceMatrixElement[];
}

interface GoogleDistanceMatrixResponse {
  status: string;
  error_message?: string;
  rows: GoogleDistanceMatrixRow[];
}

export interface GoogleDistanceMatrixServiceOptions {
  /** design.md section 7's MAP_API_KEY -- server-side only, never sent to the browser. */
  apiKey: string;
  /** Injectable for testability; defaults to the global fetch (Node 18+/Vercel runtime). */
  fetchImpl?: FetchLike;
  /** Injectable so tests don't hit the real Google endpoint. */
  endpoint?: string;
  /** Injectable clock, purely for deterministic tests of the departure_time=now parameter. */
  now?: () => Date;
  /**
   * design.md section 6.3/7's REQUEST_TIMEOUT_MS -- hard per-call timeout
   * (INC-7/NFR-004). Optional so existing unit tests that construct this
   * service without a timeout keep working unmodified (see
   * src/http/fetchWithTimeout.ts); every production caller always supplies
   * `config.requestTimeoutMs`.
   */
  timeoutMs?: number;
}

/**
 * A single origin/destination pair's resolved travel time in minutes, or
 * `null` if that specific pair has no viable driving route (Google's
 * per-element status is something other than OK, e.g. ZERO_RESULTS/
 * NOT_FOUND) -- distinct from a whole-request provider failure, which
 * throws `RoutingProviderError` instead.
 */
export type ElementDurationMinutes = number | null;

export interface DistanceMatrixService {
  /**
   * design.md section 4.3 step 6: one Distance Matrix call covering every
   * (origin, destination) pair across the two arrays -- the caller is
   * responsible for batching `destinations`/`origins` to respect
   * DISTANCE_MATRIX_BATCH_SIZE (see detourEvaluator.ts). Returns a
   * rows-by-elements matrix (`result[originIndex][destinationIndex]`)
   * mirroring Google's own response shape, so a 1xN call (start->batch)
   * and an Nx1 call (batch->dest) both fall out of the same method.
   */
  getDurationsMinutes(origins: LatLng[], destinations: LatLng[]): Promise<ElementDurationMinutes[][]>;
}

function formatLatLngList(points: LatLng[]): string {
  return points.map((p) => `${p.lat},${p.lng}`).join("|");
}

function isGoogleDistanceMatrixResponse(body: unknown): body is GoogleDistanceMatrixResponse {
  return typeof body === "object" && body !== null && "status" in body && "rows" in body;
}

/**
 * Implements the Distance Matrix leg of design.md section 4.3 against
 * Google Maps Platform's Distance Matrix API, driving mode with live
 * traffic (same `departure_time=now` traffic-aware pattern as
 * googleRoutingService.ts's Directions call). Server-side only -- see
 * detourEvaluator.ts, the sole caller. `apiKey` must never reach the
 * browser.
 */
export function createGoogleDistanceMatrixService(
  options: GoogleDistanceMatrixServiceOptions,
): DistanceMatrixService {
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const endpoint = options.endpoint ?? GOOGLE_DISTANCE_MATRIX_ENDPOINT;
  const now = options.now ?? (() => new Date());

  return {
    async getDurationsMinutes(origins: LatLng[], destinations: LatLng[]): Promise<ElementDurationMinutes[][]> {
      const url = new URL(endpoint);
      url.searchParams.set("origins", formatLatLngList(origins));
      url.searchParams.set("destinations", formatLatLngList(destinations));
      url.searchParams.set("mode", "driving");
      // Same live-traffic parameter as the direct-route call (FR-007) --
      // Distance Matrix only returns a traffic-aware duration_in_traffic
      // element when a departure_time is supplied.
      url.searchParams.set("departure_time", String(Math.floor(now().getTime() / 1000)));
      url.searchParams.set("key", options.apiKey);

      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        res = await fetchWithTimeout(fetchImpl, url.toString(), options.timeoutMs);
      } catch (err) {
        if (err instanceof ProviderTimeoutError) {
          throw new RoutingProviderError("TIMEOUT", err.message);
        }
        throw new RoutingProviderError("NETWORK_ERROR", err instanceof Error ? err.message : "Network request failed.");
      }

      if (!res.ok) {
        throw new RoutingProviderError("HTTP_ERROR", `Distance Matrix provider HTTP ${res.status}.`);
      }

      const body = await res.json();
      if (!isGoogleDistanceMatrixResponse(body)) {
        throw new RoutingProviderError(
          "MALFORMED_RESPONSE",
          "Distance Matrix provider returned an unexpected response shape.",
        );
      }

      if (body.status !== "OK") {
        throw new RoutingProviderError(body.status, body.error_message);
      }

      return body.rows.map((row) =>
        row.elements.map((element) => {
          if (element.status !== "OK") return null;
          const seconds = element.duration_in_traffic?.value ?? element.duration?.value;
          return seconds === undefined ? null : seconds / 60;
        }),
      );
    },
  };
}
