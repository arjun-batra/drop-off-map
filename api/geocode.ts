import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthGate } from "../src/auth/authGate.js";
import { ConfigError, loadConfig } from "../src/config/loader.js";
import { GeocodingProviderError } from "../src/geocoding/errors.js";
import { createGoogleGeocodingService } from "../src/geocoding/googleGeocodingService.js";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * GET /api/geocode -- design.md section 5.2. Behind AuthGate (design.md
 * section 5.1/10 -- the first real protected business endpoint; unlike
 * /api/config/public this makes a billable provider call and must be gated
 * identically to any future endpoint in paid_tier mode).
 *
 * Two query shapes, both used by the Input Screen (ux-spec.md section 4.1):
 *   ?query=<address text>       -> forward geocode (autocomplete-style resolve)
 *   ?lat=<n>&lng=<n>             -> reverse geocode (for "use my current location")
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // REV-009: never forward the raw ConfigError message to the client -- it can
    // reveal internal config-key names/validation rules. Log the detail server-side only.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/geocode] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
    return;
  }

  if (!AuthGate.check(req, config)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const query = firstQueryValue(req.query.query);
  const lat = firstQueryValue(req.query.lat);
  const lng = firstQueryValue(req.query.lng);

  const geocodingService = createGoogleGeocodingService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });

  try {
    if (query !== undefined) {
      if (query.trim().length < config.minGeocodeQueryLength) {
        res.status(400).json({ error: "query_too_short" });
        return;
      }
      const results = await geocodingService.resolve(query);
      res.status(200).json({ results });
      return;
    }

    if (lat !== undefined && lng !== undefined) {
      const parsedLat = Number(lat);
      const parsedLng = Number(lng);
      if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        res.status(400).json({ error: "invalid_point" });
        return;
      }

      try {
        const label = await geocodingService.reverseGeocode({ lat: parsedLat, lng: parsedLng });
        res.status(200).json({ results: [{ lat: parsedLat, lng: parsedLng, label }] });
      } catch (err) {
        if (err instanceof GeocodingProviderError && err.providerStatus === "ZERO_RESULTS") {
          res.status(200).json({ results: [] });
          return;
        }
        throw err;
      }
      return;
    }

    res.status(400).json({ error: "missing_query_or_point" });
  } catch (err) {
    // REV-009: the underlying provider error message (e.g. Google's own
    // error_message field) can reveal credential/config validity detail --
    // e.g. "The provided API key is invalid." Log it server-side only and
    // return a generic message to the client.
    const message = err instanceof GeocodingProviderError ? err.message : String(err);
    console.error("[api/geocode] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the geocoding provider right now." });
  }
}
