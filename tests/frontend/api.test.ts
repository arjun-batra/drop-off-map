import { afterEach, describe, expect, it, vi } from "vitest";
import { searchDropOffPoints } from "../../src/frontend/api";
import type { DropOffSearchRequest } from "../../src/search/types";

const REQUEST: DropOffSearchRequest = {
  start: { lat: 43.6532, lng: -79.3832, label: "Start" },
  driverDestination: { lat: 43.75, lng: -79.4, label: "Driver dest" },
  passengerDestination: { lat: 43.78, lng: -79.42, label: "Passenger dest" },
  maxDetourMinutes: 15,
  avoidTolls: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * REV-014 (INC-8): a *real* AbortSignal-aware fetch mock -- rejects with a
 * genuine AbortError the moment the signal fires, exactly the contract the
 * real DOM `fetch` implements. This is deliberately not a mock that merely
 * ignores the signal, so this test proves `searchDropOffPoints` genuinely
 * wires `signal` through to the underlying network call (the actual defect
 * REV-014 was filed against), not just that stale results are later ignored
 * by the caller (that was BUG-001, already covered elsewhere).
 */
function abortAwareFetchMock() {
  return vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      // Deliberately never resolves on its own -- only abort() should ever
      // settle this promise, in either direction, in these tests.
    });
  });
}

describe("searchDropOffPoints -- REV-014 request cancellation", () => {
  it("passes the given AbortSignal straight through to fetch's own signal option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "no_viable_option", candidates: [], message: "x", requestId: "r", timingMs: 1 }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const controller = new AbortController();
    await searchDropOffPoints(REQUEST, controller.signal);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it("aborting the controller genuinely cancels the underlying fetch (real AbortError propagates, not just an ignored result)", async () => {
    vi.stubGlobal("fetch", abortAwareFetchMock());

    const controller = new AbortController();
    const outcomePromise = searchDropOffPoints(REQUEST, controller.signal);

    controller.abort();
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ ok: false, errorCode: "aborted" });
  });

  it("aborting BEFORE the call is made still surfaces as an aborted outcome (signal.aborted checked/respected)", async () => {
    vi.stubGlobal("fetch", abortAwareFetchMock());

    const controller = new AbortController();
    controller.abort();
    const outcome = await searchDropOffPoints(REQUEST, controller.signal);

    expect(outcome).toEqual({ ok: false, errorCode: "aborted" });
  });

  it("without a signal, an unrelated network failure still maps to network_error, not aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const outcome = await searchDropOffPoints(REQUEST);
    expect(outcome).toEqual({ ok: false, errorCode: "network_error" });
  });
});
