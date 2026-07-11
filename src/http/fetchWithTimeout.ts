/**
 * Shared per-call timeout enforcement for every outbound provider call
 * (design.md section 6.3 / `REQUEST_TIMEOUT_MS`, INC-7). Every provider
 * service (`googleGeocodingService`, `googleRoutingService`,
 * `googleDistanceMatrixService`, `googleTransitDirectionsService`) routes
 * its `fetchImpl` call through this single function rather than
 * reimplementing timeout/abort logic four times.
 *
 * `timeoutMs` is optional and, when omitted, this is a plain passthrough
 * (no AbortController, no timer) -- this preserves every existing service's
 * unit tests (which construct services without a `timeoutMs` option) exactly
 * as before, while production call sites (the `api/*.ts` handlers) always
 * supply `config.requestTimeoutMs`, so the tunable is genuinely wired end to
 * end without changing any already-passing test's behavior.
 */

export interface FetchInit {
  signal?: AbortSignal;
}

export type TimeoutAwareFetch = (
  url: string,
  init?: FetchInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Thrown when a provider call is aborted for exceeding `REQUEST_TIMEOUT_MS`. */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider request timed out after ${timeoutMs}ms.`);
    this.name = "ProviderTimeoutError";
  }
}

export async function fetchWithTimeout(
  fetchImpl: TimeoutAwareFetch,
  url: string,
  timeoutMs: number | undefined,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  if (timeoutMs === undefined) {
    return fetchImpl(url);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
