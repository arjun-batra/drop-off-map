import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputScreen } from "../../src/frontend/components/InputScreen";
import type { PublicConfig } from "../../src/config/schema";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const baseConfig: PublicConfig = {
  appMode: "free_tier",
  geographicCenter: { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" },
  geographicRadiusKm: 200,
  maxCandidatesReturned: 3,
  transitModesIncluded: "all",
  minGeocodeQueryLength: 3,
  geocodeDebounceMs: 300,
};

// A resolved point far outside Toronto's 200km default radius (Vancouver).
const FAR_AWAY_RESULT = { lat: 49.2827, lng: -123.1207, label: "Vancouver, BC, Canada" };
const NEARBY_RESULT = { lat: 43.66, lng: -79.4, label: "456 Bay St, Toronto, ON" };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error -- test-only cleanup of a jsdom global we defineProperty'd
  delete global.navigator.geolocation;
});

function render(config: PublicConfig = baseConfig) {
  act(() => {
    root = createRoot(container);
    root.render(<InputScreen config={config} />);
  });
}

function fieldInput(labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const label = labels.find((el) => el.textContent === labelText);
  if (!label) throw new Error(`No field labeled "${labelText}" found`);
  const forId = label.getAttribute("for")!;
  // useId() produces ids containing colons (e.g. ":r1:"), which are not
  // valid bare CSS id selectors -- use an attribute selector instead.
  return container.querySelector(`[id="${forId}"]`) as HTMLInputElement;
}

function fieldWrap(labelText: string): HTMLElement {
  return fieldInput(labelText).closest(".input-screen__field") as HTMLElement;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mockGeocodeFetch(byQuery: Record<string, unknown[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const parsed = new URL(url, "http://localhost");
      const query = parsed.searchParams.get("query");
      if (query !== null) {
        const results = byQuery[query] ?? [];
        return { ok: true, status: 200, json: async () => ({ results }) };
      }
      // reverse geocode path -- not exercised by this helper's callers
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }),
  );
}

describe("InputScreen -- FR-001, FR-003, FR-004, FR-015, NFR-006", () => {
  it("FR-001: renders all three required location fields", () => {
    render();
    expect(() => fieldInput("Your start point")).not.toThrow();
    expect(() => fieldInput("Your destination")).not.toThrow();
    expect(() => fieldInput("Passenger's destination")).not.toThrow();
  });

  it("FR-015: typing 3+ characters queries the geocoder and selecting a suggestion resolves the field", async () => {
    mockGeocodeFetch({ "456 Bay": [{ lat: NEARBY_RESULT.lat, lng: NEARBY_RESULT.lng, label: NEARBY_RESULT.label }] });
    render();

    const input = fieldInput("Your start point");
    act(() => setValue(input, "456 Bay"));
    await advance(300);
    await flush();

    const option = container.querySelector('li[role="option"]');
    expect(option?.textContent).toBe(NEARBY_RESULT.label);

    act(() => {
      option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(input.value).toBe(NEARBY_RESULT.label);
    expect(fieldWrap("Your start point").querySelector(".input-screen__status-icon")?.textContent).toBe("✓");
  });

  it("FR-015: 'use my current location' populates the field via reverse geocode and shows the current-location badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ lat: NEARBY_RESULT.lat, lng: NEARBY_RESULT.lng, label: NEARBY_RESULT.label }] }),
      })),
    );
    Object.defineProperty(global.navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: (position: { coords: { latitude: number; longitude: number } }) => void) => {
          success({ coords: { latitude: NEARBY_RESULT.lat, longitude: NEARBY_RESULT.lng } });
        },
      },
      configurable: true,
    });

    render();
    const button = fieldWrap("Your start point").querySelector(
      ".input-screen__geolocate",
    ) as HTMLButtonElement;

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const input = fieldInput("Your start point");
    expect(input.value).toBe(NEARBY_RESULT.label);
    expect(fieldWrap("Your start point").textContent).toContain("Current location");
  });

  it("FR-015 edge case: geolocation unavailable shows the specified copy, never leaves the field silently unexplained", async () => {
    // No navigator.geolocation defined at all -- simulates an unsupported browser.
    render();
    const button = fieldWrap("Your destination").querySelector(
      ".input-screen__geolocate",
    ) as HTMLButtonElement;

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fieldWrap("Your destination").textContent).toContain(
      "Location access wasn't available. Please type an address instead.",
    );
  });

  it("FR-003: an address with zero geocode results shows the unresolvable inline error", async () => {
    mockGeocodeFetch({ "nonsense address xyz": [] });
    render();

    const input = fieldInput("Passenger's destination");
    act(() => setValue(input, "nonsense address xyz"));
    await advance(300);
    await flush();

    expect(fieldWrap("Passenger's destination").textContent).toContain(
      "We couldn't find that address. Try a more specific address or a nearby cross street.",
    );
  });

  describe("FR-004 (resolved DQ-1): radius check applies to start + driver destination ONLY", () => {
    it("a far-away resolved address on the driver's destination field is blocked with the out-of-service-area message", async () => {
      mockGeocodeFetch({ Vancouver: [FAR_AWAY_RESULT] });
      render();

      const input = fieldInput("Your destination");
      act(() => setValue(input, "Vancouver"));
      await advance(300);
      await flush();

      const option = container.querySelector('li[role="option"]');
      act(() => {
        option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
      });
      await flush();

      expect(fieldWrap("Your destination").textContent).toContain("outside our service area");
      expect(fieldWrap("Your destination").textContent).toContain("within 200 km of Toronto, ON");
    });

    it("the SAME far-away address is accepted with no radius error on passenger's destination (exemption)", async () => {
      mockGeocodeFetch({ Vancouver: [FAR_AWAY_RESULT] });
      render();

      const input = fieldInput("Passenger's destination");
      act(() => setValue(input, "Vancouver"));
      await advance(300);
      await flush();

      const option = container.querySelector('li[role="option"]');
      act(() => {
        option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
      });
      await flush();

      expect(fieldWrap("Passenger's destination").textContent).not.toContain("outside our service area");
      expect(fieldWrap("Passenger's destination").querySelector(".input-screen__status-icon")?.textContent).toBe(
        "✓",
      );
    });

    it("the SAME far-away address is ALSO blocked on the start-point field (not just driver destination)", async () => {
      mockGeocodeFetch({ Vancouver: [FAR_AWAY_RESULT] });
      render();

      const input = fieldInput("Your start point");
      act(() => setValue(input, "Vancouver"));
      await advance(300);
      await flush();

      const option = container.querySelector('li[role="option"]');
      act(() => {
        option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
      });
      await flush();

      expect(fieldWrap("Your start point").textContent).toContain("outside our service area");
    });
  });

  describe("NFR-006: configurability of the radius/center used by the FR-004 check", () => {
    it("a point rejected under the default 200km radius is accepted once GEOGRAPHIC_RADIUS_KM is widened via config", async () => {
      mockGeocodeFetch({ Vancouver: [FAR_AWAY_RESULT] });
      const widenedConfig: PublicConfig = { ...baseConfig, geographicRadiusKm: 5000 };
      render(widenedConfig);

      const input = fieldInput("Your destination");
      act(() => setValue(input, "Vancouver"));
      await advance(300);
      await flush();

      const option = container.querySelector('li[role="option"]');
      act(() => {
        option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
      });
      await flush();

      expect(fieldWrap("Your destination").textContent).not.toContain("outside our service area");
    });

    it("the out-of-service-area copy substitutes the actual configured center label, not a hardcoded 'Toronto'", async () => {
      mockGeocodeFetch({ Vancouver: [FAR_AWAY_RESULT] });
      const ottawaConfig: PublicConfig = {
        ...baseConfig,
        geographicCenter: { lat: 45.4215, lng: -75.6972, label: "Ottawa, ON" },
        geographicRadiusKm: 10,
      };
      render(ottawaConfig);

      const input = fieldInput("Your destination");
      act(() => setValue(input, "Vancouver"));
      await advance(300);
      await flush();

      const option = container.querySelector('li[role="option"]');
      act(() => {
        option!.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
      });
      await flush();

      expect(fieldWrap("Your destination").textContent).toContain("within 10 km of Ottawa, ON");
    });
  });

  describe("autocomplete debounce/min-length behavior (ux-spec.md section 4.1)", () => {
    it("does not query the geocoder for fewer than 3 characters", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
      vi.stubGlobal("fetch", fetchSpy);
      render();

      const input = fieldInput("Your start point");
      act(() => setValue(input, "ab"));
      await advance(1000);
      await flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("debounces rapid keystrokes into a single geocode request", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
      vi.stubGlobal("fetch", fetchSpy);
      render();

      const input = fieldInput("Your start point");
      act(() => setValue(input, "123"));
      await advance(100);
      act(() => setValue(input, "123 Main"));
      await advance(100);
      act(() => setValue(input, "123 Main St"));
      await advance(300);
      await flush();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("configurability (REV-006/REV-007): a lower configured minGeocodeQueryLength queries the geocoder for fewer characters than the default 3", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
      vi.stubGlobal("fetch", fetchSpy);
      const shorterMinConfig: PublicConfig = { ...baseConfig, minGeocodeQueryLength: 1 };
      render(shorterMinConfig);

      const input = fieldInput("Your start point");
      // 2 chars -- would NOT trigger a lookup under the default config of 3
      // (see the sibling test above), but must under this configured value of 1.
      act(() => setValue(input, "ab"));
      await advance(300);
      await flush();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("configurability (REV-006/REV-007): a higher configured minGeocodeQueryLength suppresses a lookup that the default 3 would have allowed", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
      vi.stubGlobal("fetch", fetchSpy);
      const higherMinConfig: PublicConfig = { ...baseConfig, minGeocodeQueryLength: 5 };
      render(higherMinConfig);

      const input = fieldInput("Your start point");
      // 4 chars -- would trigger a lookup under the default config of 3, must NOT under 5.
      act(() => setValue(input, "abcd"));
      await advance(300);
      await flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("configurability (REV-006/REV-007): a longer configured geocodeDebounceMs delays the request beyond the default 300ms", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
      vi.stubGlobal("fetch", fetchSpy);
      const longerDebounceConfig: PublicConfig = { ...baseConfig, geocodeDebounceMs: 1000 };
      render(longerDebounceConfig);

      const input = fieldInput("Your start point");
      act(() => setValue(input, "123 Main St"));

      // Just past the default 300ms -- must NOT have fired yet under the
      // configured 1000ms debounce.
      await advance(400);
      await flush();
      expect(fetchSpy).not.toHaveBeenCalled();

      // Now past the configured 1000ms window -- must have fired.
      await advance(700);
      await flush();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("known-limitation follow-up: blur-vs-in-flight-geocode race (handoff.md item 5)", () => {
    it("self-corrects: a blur before the debounced response arrives may transiently show 'unresolvable' but converges to the real result", async () => {
      mockGeocodeFetch({ "456 Bay": [{ lat: NEARBY_RESULT.lat, lng: NEARBY_RESULT.lng, label: NEARBY_RESULT.label }] });
      render();

      const input = fieldInput("Your start point");
      act(() => setValue(input, "456 Bay"));

      // Blur fires almost immediately (component defers 150ms before calling
      // field.onBlur), well before the 300ms geocode debounce elapses.
      act(() => {
        input.dispatchEvent(new Event("blur", { bubbles: true }));
      });
      await advance(150);
      await flush();

      // Transient/incorrect state is tolerated here (matches dev's documented caveat).
      // The important assertion is what happens next: it must self-correct.
      await advance(150); // completes the 300ms debounce window
      await flush();

      expect(fieldWrap("Your start point").textContent).not.toContain("We couldn't find that address");
      const option = container.querySelector('li[role="option"]');
      expect(option?.textContent).toBe(NEARBY_RESULT.label);
    });
  });
});
