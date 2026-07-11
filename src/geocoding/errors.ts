/**
 * Thrown when Google's Geocoding API responds with a non-OK, non-ZERO_RESULTS
 * status (e.g. OVER_QUERY_LIMIT, REQUEST_DENIED, UNKNOWN_ERROR) or the HTTP
 * call itself fails. ZERO_RESULTS is treated as a normal empty result, not an
 * error -- see googleGeocodingService.ts.
 */
export class GeocodingProviderError extends Error {
  readonly providerStatus: string;

  constructor(providerStatus: string, message?: string) {
    super(message ?? `Geocoding provider returned status "${providerStatus}".`);
    this.name = "GeocodingProviderError";
    this.providerStatus = providerStatus;
  }
}
