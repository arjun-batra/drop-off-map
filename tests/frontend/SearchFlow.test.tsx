import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchFlow } from "../../src/frontend/components/SearchFlow";
import type { PublicConfig } from "../../src/config/schema";
import * as api from "../../src/frontend/api";
import type { SearchOutcome } from "../../src/frontend/api";
import { DISCLAIMER_TEXT } from "../../src/search/types";

/**
 * INC-10 (FR-022): unlike the rest of this file, one describe block below
 * (the map async-load-failure end-to-end check) exercises the REAL
 * `MapView` component -- not a stub -- through the real `SearchFlow` ->
 * `ResultsScreen` composition, to verify the same "does a crash here take
 * down the rest of the screen" bar REV-012 already established for the
 * disclaimer, but for the new async (Promise-rejection) load-failure path
 * `@googlemaps/js-api-loader` introduces (an `ErrorBoundary` alone cannot
 * catch a rejected Promise). Every other test in this file leaves
 * `googleMapsJsApiKey: null`, so `MapView` is never mounted for them and
 * this mock is simply never exercised -- the default (resolve) here would
 * only matter if a future test in this file also enabled the map without
 * overriding it.
 */
const mapLoaderState = vi.hoisted(() => {
  class NoopMap {
    fitBounds() {}
    setCenter() {}
    setZoom() {}
  }
  class NoopMarker {
    addListener() {
      return { remove() {} };
    }
    setIcon() {}
    setMap() {}
  }
  class NoopPolyline {
    setMap() {}
  }
  class NoopBounds {
    extend() {}
  }
  return { shouldFail: false, NoopMap, NoopMarker, NoopPolyline, NoopBounds };
});
vi.mock("@googlemaps/js-api-loader", () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(async (name: string) => {
    if (mapLoaderState.shouldFail) {
      throw new Error("mock Google Maps JS API load failure (SearchFlow end-to-end check)");
    }
    if (name === "marker") return { Marker: mapLoaderState.NoopMarker };
    if (name === "maps") return { Map: mapLoaderState.NoopMap, Polyline: mapLoaderState.NoopPolyline };
    return { LatLngBounds: mapLoaderState.NoopBounds, Size: class {}, Point: class {} };
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const config: PublicConfig = {
  appMode: "free_tier",
  geographicCenter: { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" },
  geographicRadiusKm: 200,
  maxCandidatesReturned: 3,
  transitModesIncluded: "all",
  minGeocodeQueryLength: 3,
  geocodeDebounceMs: 300,
  responseTimeTargetSeconds: 5,
  googleMapsJsApiKey: null,
};

const RESOLVED = { lat: 43.66, lng: -79.4, label: "456 Bay St, Toronto, ON" };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  mapLoaderState.shouldFail = false;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render(overrideConfig: PublicConfig = config) {
  act(() => {
    root = createRoot(container);
    root.render(<SearchFlow config={overrideConfig} />);
  });
}

/** Fills and resolves all 3 location fields + a valid detour, driving InputScreen's onSubmit directly via geocode mocking would be slow -- instead we drive the CTA via the "Edit search" initialValues re-open shortcut once available, or directly submit via a minimal fill. Here we mock geocodeQuery for autocomplete-free resolution isn't available, so we fill/select via the DOM like InputScreen.test.tsx does. */
function fieldInput(labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const label = labels.find((el) => el.textContent === labelText);
  if (!label) throw new Error(`No field labeled "${labelText}" found`);
  const forId = label.getAttribute("for")!;
  return container.querySelector(`[id="${forId}"]`) as HTMLInputElement;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mockGeocodeAlwaysResolves() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname.includes("/api/geocode")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ lat: RESOLVED.lat, lng: RESOLVED.lng, label: RESOLVED.label }] }),
        };
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

async function fillAndSubmit() {
  mockGeocodeAlwaysResolves();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  for (const label of ["Your start point", "Your destination", "Passenger's destination"]) {
    const input = fieldInput(label);
    act(() => setValue(input, "456 Bay St"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flush();
    const option = container.querySelector('li[role="option"]') as HTMLElement;
    act(() => {
      option.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  vi.useRealTimers();

  const detourInput = container.querySelector("#max-detour-input") as HTMLInputElement;
  act(() => setValue(detourInput, "15"));

  const cta = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Find drop-off points")!;
  expect((cta as HTMLButtonElement).disabled).toBe(false);
  act(() => {
    cta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

describe("SearchFlow -- ux-spec.md Input -> Loading -> Results | Error orchestration", () => {
  it("submitting a valid request shows the Loading screen, then Results on success", async () => {
    render();
    let resolveSearch!: (value: SearchOutcome) => void;
    vi.spyOn(api, "searchDropOffPoints").mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    await fillAndSubmit();
    expect(container.textContent).toContain("Finding the best drop-off");

    await act(async () => {
      resolveSearch({
        ok: true,
        response: { status: "no_viable_option", candidates: [], message: "no luck", requestId: "r1", timingMs: 5 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("No drop-off points found");
  });

  it("a failed/network-error outcome renders the SearchErrorScreen, not a crash or a blank screen", async () => {
    render();
    vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({ ok: false, errorCode: "network_error" });

    await fillAndSubmit();

    expect(container.textContent).toContain("Something went wrong");
  });

  it('"Edit search" from Results returns to the Input screen with the submitted values preserved', async () => {
    render();
    vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
      ok: true,
      response: { status: "no_viable_option", candidates: [], message: "no luck", requestId: "r1", timingMs: 5 },
    });

    await fillAndSubmit();
    expect(container.textContent).toContain("No drop-off points found");

    const editLink = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Edit search"))!;
    act(() => {
      editLink.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("DropSpot");
    const startInput = fieldInput("Your start point");
    expect(startInput.value).toBe(RESOLVED.label);
  });

  it('"Try again" from the error screen re-issues the identical request', async () => {
    render();
    const searchSpy = vi
      .spyOn(api, "searchDropOffPoints")
      .mockResolvedValueOnce({ ok: false, errorCode: "network_error" })
      .mockResolvedValueOnce({
        ok: true,
        response: { status: "no_viable_option", candidates: [], message: "no luck", requestId: "r1", timingMs: 5 },
      });

    await fillAndSubmit();
    expect(container.textContent).toContain("Something went wrong");

    const tryAgainButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    act(() => {
      tryAgainButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(searchSpy).toHaveBeenCalledTimes(2);
    expect(searchSpy.mock.calls[0]).toEqual(searchSpy.mock.calls[1]);
    expect(container.textContent).toContain("No drop-off points found");
  });

  // BUG-001 (see docs/test-report.md): SearchFlow.tsx's runSearch() had no
  // cancellation token/AbortController, so a stale in-flight request that
  // resolved AFTER the user clicked Cancel would silently overwrite whatever
  // screen the user had navigated to since. Dev's fix cycle 1 added a
  // monotonically-incrementing `currentSearchToken` ref checked before every
  // `setStage` call inside `runSearch`. Independently re-verified (see the
  // "BUG-001 fix verification" describe block below) -- flipped back to a
  // normal `it(...)` now that it genuinely passes.
  it("BUG-001: clicking Cancel during Loading returns to Input, and a stale in-flight response later does NOT navigate the user away from Input to Results (race condition, no longer reproducible)", async () => {
    render();
    let resolveSearch!: (value: SearchOutcome) => void;
    vi.spyOn(api, "searchDropOffPoints").mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    await fillAndSubmit();
    expect(container.textContent).toContain("Finding the best drop-off");

    // User cancels while the request is still in flight.
    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    act(() => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    // Confirm we're genuinely back on the Input screen immediately after Cancel.
    expect(container.textContent).toContain("DropSpot");
    expect(container.textContent).not.toContain("Finding the best drop-off");

    // The stale request now resolves (simulating a slow network response that
    // arrives after the user already cancelled and is looking at Input again).
    await act(async () => {
      resolveSearch({
        ok: true,
        response: {
          status: "ranked",
          candidates: [
            {
              rank: 1,
              location: { lat: 43.66, lng: -79.4 },
              label: "Oak Ave & Main St",
              routeOrderIndex: 0,
              driveTimeToDropoffMinutes: 8,
              detourMinutes: 3,
              walkTimeMinutes: 4,
              waitTimeMinutes: 5,
              transitTimeMinutes: 17,
              passengerTotalTimeMinutes: 26,
              driverTotalTimeMinutes: 27,
              exceedsThreshold: false,
            },
          ],
          requestId: "stale-request",
          timingMs: 5000,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // EXPECTED (per ux-spec.md section 5: "Cancel... returns the user to the
    // Input screen"): the user should still be on the Input screen, since
    // they explicitly cancelled. If this assertion fails, it confirms the
    // race condition: SearchFlow.tsx's runSearch() has no cancellation
    // token/AbortController, so a stale promise resolving after Cancel
    // silently overwrites the user's current screen.
    expect(container.textContent).toContain("DropSpot");
    expect(container.textContent).not.toContain("Oak Ave & Main St");
  });

  // BUG-001's compounding case, independently re-verified per dev's claim
  // that the same token mechanism also covers an *older* search resolving
  // after a *newer* one has already started (not just the simple
  // cancel-then-resolve case above). Two overlapping searches are issued
  // (the second submitted only after cancelling/leaving the first's Loading
  // screen -- the only way this app lets a user "go back and submit a
  // different search" mid-flight); the newer one resolves first (the normal
  // order), and the older one is then resolved afterward, out of order. The
  // correct/newer result must remain displayed -- the stale older response
  // must be a no-op, not silently overwrite the newer, already-rendered
  // results.
  it("BUG-001 compounding case: an older, superseded search resolving after a newer one has already rendered its results does not clobber them", async () => {
    render();
    let resolveOlder!: (value: SearchOutcome) => void;
    let resolveNewer!: (value: SearchOutcome) => void;
    const searchSpy = vi.spyOn(api, "searchDropOffPoints");
    searchSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOlder = resolve;
      }),
    );

    await fillAndSubmit();
    expect(container.textContent).toContain("Finding the best drop-off");

    // Leave the first (older) search's Loading screen without it ever
    // resolving, then submit a second, newer search.
    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    act(() => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain("DropSpot");

    searchSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNewer = resolve;
      }),
    );
    await fillAndSubmit();
    expect(container.textContent).toContain("Finding the best drop-off");
    expect(searchSpy).toHaveBeenCalledTimes(2);

    const candidateBase = {
      rank: 1,
      location: { lat: 43.66, lng: -79.4 },
      routeOrderIndex: 0,
      driveTimeToDropoffMinutes: 8,
      detourMinutes: 3,
      walkTimeMinutes: 4,
      waitTimeMinutes: 5,
      transitTimeMinutes: 17,
      passengerTotalTimeMinutes: 26,
      driverTotalTimeMinutes: 27,
      exceedsThreshold: false,
    };

    // The NEWER search resolves first (the normal, non-race order).
    await act(async () => {
      resolveNewer({
        ok: true,
        response: {
          status: "ranked",
          candidates: [{ ...candidateBase, label: "Newer Candidate Rd" }],
          requestId: "newer-request",
          timingMs: 5,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Newer Candidate Rd");

    // The OLDER (superseded) search now resolves out of order, after the
    // newer one's results are already on screen.
    await act(async () => {
      resolveOlder({
        ok: true,
        response: {
          status: "ranked",
          candidates: [{ ...candidateBase, label: "Older Candidate Rd" }],
          requestId: "older-request",
          timingMs: 9000,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The newer, correct result must still be displayed -- the older
    // response must not have silently won just because it resolved after.
    expect(container.textContent).toContain("Newer Candidate Rd");
    expect(container.textContent).not.toContain("Older Candidate Rd");
  });

  describe("FR-014/REV-012: disclaimer resilience (independent QA verification, not just dev's self-report)", () => {
    it("a normal ranked result shows the disclaimer banner with the exact required copy alongside the results", async () => {
      render();
      vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
        ok: true,
        response: {
          status: "ranked",
          candidates: [
            {
              rank: 1,
              location: { lat: 43.66, lng: -79.4 },
              label: "Oak Ave & Main St",
              routeOrderIndex: 0,
              driveTimeToDropoffMinutes: 8,
              detourMinutes: 3,
              walkTimeMinutes: 4,
              waitTimeMinutes: 5,
              transitTimeMinutes: 17,
              passengerTotalTimeMinutes: 26,
              driverTotalTimeMinutes: 27,
              exceedsThreshold: false,
            },
          ],
          disclaimer: DISCLAIMER_TEXT,
          requestId: "r1",
          timingMs: 5,
        },
      });

      await fillAndSubmit();

      expect(container.textContent).toContain(DISCLAIMER_TEXT);
      expect(container.textContent).toContain("Oak Ave & Main St");
    });

    it("no_viable_option does not show the disclaimer (design.md section 5.2's candidates.length > 0 contract, per SearchFlow's showDisclaimer check)", async () => {
      render();
      vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
        ok: true,
        response: { status: "no_viable_option", candidates: [], message: "no luck", requestId: "r1", timingMs: 5 },
      });

      await fillAndSubmit();

      expect(container.textContent).toContain("No drop-off points found");
      expect(container.textContent).not.toContain(DISCLAIMER_TEXT);
    });

    // This is the orchestrator's specifically-requested independent check:
    // rather than trusting dev's scratch-test self-report, force a REAL crash
    // inside ResultsScreen's own rendering (a malformed `candidates` entry --
    // `null` -- causes `candidate.rank` to throw the instant React evaluates
    // the .map() callback, a genuine data-driven crash, not a synthetic swap-
    // in of a fake throwing component) and confirm the disclaimer, rendered
    // as a structural sibling outside the ErrorBoundary, survives.
    it("a genuine crash in ResultsScreen's data-dependent rendering (malformed candidate data) does not take the disclaimer down with it", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render();
      vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
        ok: true,
        response: {
          status: "ranked",
          // Deliberately malformed: a null candidate entry. ResultsScreen's
          // `response.candidates.map((candidate) => <CandidateCard
          // key={candidate.rank} .../>)` will throw a real TypeError here
          // ("Cannot read properties of null") -- this is not a mock/stub of
          // a throw, it is the actual production component crashing on bad
          // data, exactly the scenario ux-spec.md section 6.2 and REV-012
          // are both about.
          candidates: [null] as never,
          disclaimer: DISCLAIMER_TEXT,
          requestId: "r1",
          timingMs: 5,
        },
      });

      await fillAndSubmit();

      // The ErrorBoundary's fallback took over ResultsScreen's subtree...
      expect(container.textContent).toContain("Something went wrong showing your results");
      // ...but the disclaimer, rendered as a sibling OUTSIDE that boundary,
      // is still present in the very same render pass. This is the
      // structural (not conventional) guarantee REV-012 required.
      expect(container.textContent).toContain(DISCLAIMER_TEXT);

      consoleErrorSpy.mockRestore();
    });

    it("the 'Edit search' escape hatch in the crash fallback still works even while the disclaimer above it is showing", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render();
      vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
        ok: true,
        response: {
          status: "ranked",
          candidates: [null] as never,
          disclaimer: DISCLAIMER_TEXT,
          requestId: "r1",
          timingMs: 5,
        },
      });

      await fillAndSubmit();
      expect(container.textContent).toContain(DISCLAIMER_TEXT);

      const editLink = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Edit search"),
      )!;
      act(() => {
        editLink.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();

      expect(container.textContent).toContain("DropSpot");
      consoleErrorSpy.mockRestore();
    });
  });

  describe("INC-10/FR-022: map async-load-failure resilience, same bar as REV-012 (real MapView + real ErrorBoundary composition, not mocked out)", () => {
    it("a Google Maps JS API load failure (rejected importLibrary() promise) omits only the map panel -- candidate cards and the FR-014 disclaimer survive untouched, exactly like a synchronous crash would under REV-012", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mapLoaderState.shouldFail = true;
      render({ ...config, googleMapsJsApiKey: "test-gmaps-js-key" });
      vi.spyOn(api, "searchDropOffPoints").mockResolvedValue({
        ok: true,
        response: {
          status: "ranked",
          candidates: [
            {
              rank: 1,
              location: { lat: 43.66, lng: -79.4 },
              label: "Oak Ave & Main St",
              routeOrderIndex: 0,
              driveTimeToDropoffMinutes: 8,
              detourMinutes: 3,
              walkTimeMinutes: 4,
              waitTimeMinutes: 5,
              transitTimeMinutes: 17,
              passengerTotalTimeMinutes: 26,
              driverTotalTimeMinutes: 27,
              exceedsThreshold: false,
            },
          ],
          route: [
            { lat: 43.6532, lng: -79.3832 },
            { lat: 43.7, lng: -79.4 },
          ],
          disclaimer: DISCLAIMER_TEXT,
          requestId: "r1",
          timingMs: 5,
        },
      });

      await fillAndSubmit();
      // Give MapView's async init() a chance to reject and settle loadFailed.
      await flush();
      await flush();

      // The map panel never appears (async guard renders null, not a broken
      // panel) -- MapView.tsx's own container div carries this class.
      expect(container.querySelector(".map-view")).toBeNull();
      // ...but the rest of the Results screen is completely unaffected: the
      // candidate card and the FR-014 disclaimer (rendered as a sibling
      // outside ResultsScreen's ErrorBoundary, per REV-012) both render
      // normally in the very same pass.
      expect(container.textContent).toContain("Oak Ave & Main St");
      expect(container.textContent).toContain(DISCLAIMER_TEXT);
      // No uncaught exception reached the top of the component tree -- if it
      // had, `fillAndSubmit`/`flush`'s act() calls would have thrown.
      consoleErrorSpy.mockRestore();
    });
  });

  describe("REV-014 -- SearchFlow genuinely aborts the underlying request, not just its own token guard", () => {
    it("clicking Cancel aborts the real AbortSignal passed to searchDropOffPoints", async () => {
      render();
      let capturedSignal: AbortSignal | undefined;
      vi.spyOn(api, "searchDropOffPoints").mockImplementation((_request, signal) => {
        capturedSignal = signal;
        return new Promise(() => {
          /* never resolves -- only Cancel should settle anything here */
        });
      });

      await fillAndSubmit();
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      const cancelButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Cancel",
      )!;
      act(() => {
        cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();

      // The exact signal instance handed to searchDropOffPoints for the
      // cancelled search must itself report aborted:true -- this is the
      // genuine network-cancellation signal REV-014 requires, not merely
      // the pre-existing BUG-001 token guard (which only discards a result
      // after the fact and would pass even if no AbortController existed).
      expect(capturedSignal!.aborted).toBe(true);
    });

    it("each new search issues a fresh, non-aborted signal (the abort from a prior cancelled search is not reused/leaked forward)", async () => {
      render();
      const capturedSignals: AbortSignal[] = [];
      vi.spyOn(api, "searchDropOffPoints").mockImplementation((_request, signal) => {
        capturedSignals.push(signal!);
        return new Promise(() => {
          /* never resolves */
        });
      });

      await fillAndSubmit();
      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0]!.aborted).toBe(false);

      const cancelButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Cancel",
      )!;
      act(() => {
        cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();
      expect(capturedSignals[0]!.aborted).toBe(true);

      await fillAndSubmit();
      expect(capturedSignals).toHaveLength(2);
      // A distinct AbortController/signal per search -- the second search's
      // signal is its own object and is not aborted just because the first
      // one's controller was.
      expect(capturedSignals[1]).not.toBe(capturedSignals[0]);
      expect(capturedSignals[1]!.aborted).toBe(false);
    });
  });
});
