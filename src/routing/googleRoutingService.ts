import type { LatLng } from "../geo/types";
import { fetchWithTimeout, ProviderTimeoutError, type TimeoutAwareFetch } from "../http/fetchWithTimeout";
import { decodePolyline } from "./polyline";
import { RoutingProviderError } from "./errors";
import type { DirectRouteResult, RoutingService } from "./types";

const GOOGLE_DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

type FetchLike = TimeoutAwareFetch;

interface GoogleDirectionsLeg {
  duration: { value: number };
  duration_in_traffic?: { value: number };
}

interface GoogleDirectionsRoute {
  legs: GoogleDirectionsLeg[];
  overview_polyline: { points: string };
}

interface GoogleDirectionsResponse {
  status: string;
  error_message?: string;
  routes: GoogleDirectionsRoute[];
}

export interface GoogleRoutingServiceOptions {
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
   * src/http/fetchWithTimeout.ts); every production caller (api/route/direct.ts,
   * api/candidates/evaluate.ts, api/candidates/transit.ts, api/drop-off-search.ts)
   * always supplies `config.requestTimeoutMs`.
   */
  timeoutMs?: number;
}

function isGoogleDirectionsResponse(body: unknown): body is GoogleDirectionsResponse {
  return typeof body === "object" && body !== null && "status" in body;
}

function formatLatLng(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

/**
 * Implements `RoutingService` (design.md section 5.1) against Google Maps
 * Platform's Directions API, driving mode with live traffic (design.md
 * section 3's chosen provider/SKU for FR-006a/b, FR-007) -- not the newer
 * Routes API; design.md section 3/4.1 both describe the Directions API
 * (`departure_time=now`, traffic-aware duration) explicitly. Server-side
 * only -- see api/route/direct.ts, the sole caller. `apiKey` must never
 * reach the browser.
 */
export function createGoogleRoutingService(options: GoogleRoutingServiceOptions): RoutingService {
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const endpoint = options.endpoint ?? GOOGLE_DIRECTIONS_ENDPOINT;
  const now = options.now ?? (() => new Date());

  return {
    async getDirectRoute(start: LatLng, dest: LatLng): Promise<DirectRouteResult> {
      const url = new URL(endpoint);
      url.searchParams.set("origin", formatLatLng(start));
      url.searchParams.set("destination", formatLatLng(dest));
      url.searchParams.set("mode", "driving");
      // FR-007: live traffic, not static/historical-average duration. Directions
      // API only returns a traffic-aware `duration_in_traffic` leg field when a
      // departure_time is supplied; "now" is the live-traffic request shape
      // design.md section 4.1 step 2 calls for.
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
        throw new RoutingProviderError("HTTP_ERROR", `Routing provider HTTP ${res.status}.`);
      }

      const body = await res.json();
      if (!isGoogleDirectionsResponse(body)) {
        throw new RoutingProviderError("MALFORMED_RESPONSE", "Routing provider returned an unexpected response shape.");
      }

      if (body.status !== "OK") {
        throw new RoutingProviderError(body.status, body.error_message);
      }

      const [route] = body.routes;
      const leg = route?.legs[0];
      if (!route || !leg) {
        throw new RoutingProviderError("NO_ROUTE", "Routing provider returned no route.");
      }

      // Prefer the traffic-aware duration (FR-007). Falling back to the
      // static `duration` is a defensive edge case, not the expected path --
      // Google returns `duration_in_traffic` for essentially every drivable
      // road-network leg once `departure_time` is supplied -- but a hard
      // failure here would take down the whole feature over a single edge
      // case Google's own docs don't guarantee against (e.g. a leg type that
      // doesn't support traffic modeling).
      const durationSeconds = leg.duration_in_traffic?.value ?? leg.duration.value;

      return {
        durationMinutes: durationSeconds / 60,
        polyline: decodePolyline(route.overview_polyline.points),
      };
    },
  };
}
