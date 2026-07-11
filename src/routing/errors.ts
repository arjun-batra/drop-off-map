/**
 * Thrown when Google's Directions API responds with a non-OK status (e.g.
 * NOT_FOUND, ZERO_RESULTS, OVER_QUERY_LIMIT, REQUEST_DENIED, UNKNOWN_ERROR) or
 * the HTTP call itself fails. Unlike geocoding's ZERO_RESULTS, a direct route
 * has no meaningful "empty success" case -- two resolved points either have a
 * drivable route or they don't -- so every non-OK status is an error here.
 */
export class RoutingProviderError extends Error {
  readonly providerStatus: string;

  constructor(providerStatus: string, message?: string) {
    super(message ?? `Routing provider returned status "${providerStatus}".`);
    this.name = "RoutingProviderError";
    this.providerStatus = providerStatus;
  }
}
