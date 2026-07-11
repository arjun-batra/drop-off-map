import { describe, expect, it } from "vitest";
import { fetchWithTimeout, ProviderTimeoutError, type TimeoutAwareFetch } from "../../src/http/fetchWithTimeout";

/** A fetchImpl that only ever resolves/rejects in reaction to its AbortSignal -- proves an
 * abort is a genuine signal-driven cancellation, not merely a coincidentally-fast return. */
function hangingFetch(): TimeoutAwareFetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    });
}

describe("fetchWithTimeout -- design.md section 6.3 / REQUEST_TIMEOUT_MS (NFR-004, INC-7)", () => {
  it("happy path: a fast call resolves normally, untouched, when timeoutMs is provided", async () => {
    const fetchImpl: TimeoutAwareFetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ url }),
    });

    const result = await fetchWithTimeout(fetchImpl, "https://example.com/x", 1000);
    expect(result.ok).toBe(true);
    expect(await result.json()).toEqual({ url: "https://example.com/x" });
  });

  it("edge case: a call that hangs past timeoutMs is genuinely aborted and rejects with ProviderTimeoutError", async () => {
    const fetchImpl = hangingFetch();

    await expect(fetchWithTimeout(fetchImpl, "https://example.com/x", 20)).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("ProviderTimeoutError's message identifies the configured timeout, for server-side logging only", async () => {
    const fetchImpl = hangingFetch();

    await expect(fetchWithTimeout(fetchImpl, "https://example.com/x", 15)).rejects.toMatchObject({
      message: expect.stringContaining("15ms"),
    });
  });

  it("configurability: a longer timeoutMs allows a call that would have timed out at a shorter value to succeed", async () => {
    const fetchImpl: TimeoutAwareFetch = (_url, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}) }), 30);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

    await expect(fetchWithTimeout(fetchImpl, "https://example.com/x", 10)).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
    await expect(fetchWithTimeout(fetchImpl, "https://example.com/x", 100)).resolves.toMatchObject({ ok: true });
  });

  it("invalid input / non-abort error: a genuine network failure is not mistaken for a timeout", async () => {
    const fetchImpl: TimeoutAwareFetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND example.com");
    };

    await expect(fetchWithTimeout(fetchImpl, "https://example.com/x", 1000)).rejects.toThrow(
      "getaddrinfo ENOTFOUND example.com",
    );
  });

  it("omitting timeoutMs is a pure passthrough -- no AbortController/timer machinery at all", async () => {
    let receivedInit: unknown;
    const fetchImpl: TimeoutAwareFetch = async (_url, init) => {
      receivedInit = init;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await fetchWithTimeout(fetchImpl, "https://example.com/x", undefined);
    expect(receivedInit).toBeUndefined();
  });
});
