import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchFlow } from "../../src/frontend/components/SearchFlow";
import type { PublicConfig } from "../../src/config/schema";
import * as api from "../../src/frontend/api";

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
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render() {
  act(() => {
    root = createRoot(container);
    root.render(<SearchFlow config={config} />);
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
    let resolveSearch!: (value: unknown) => void;
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

  // BUG-001 (see docs/test-report.md): SearchFlow.tsx's runSearch() has no
  // cancellation token/AbortController, so a stale in-flight request that
  // resolves AFTER the user clicks Cancel silently overwrites whatever
  // screen the user has navigated to since. Marked `.fails` so this is
  // tracked as a known, filed regression rather than a silent skip -- flip
  // back to a normal `it(...)` once dev fixes BUG-001 and this should pass.
  it.fails("BUG-001: clicking Cancel during Loading returns to Input, but a stale in-flight response later silently navigates the user away from Input to Results (race condition, not aborted)", async () => {
    render();
    let resolveSearch!: (value: unknown) => void;
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
});
