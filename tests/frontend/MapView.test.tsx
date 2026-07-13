import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INC-10: MapView.tsx now loads Google's Maps JavaScript API via
 * `@googlemaps/js-api-loader`'s functional API (`setOptions`/`importLibrary`)
 * instead of bundled/synchronous Leaflet. That load is asynchronous (a real
 * network script fetch in production) and there is no real
 * `GOOGLE_MAPS_JS_API_KEY`/network access in this sandbox, so this file mocks
 * `@googlemaps/js-api-loader` itself (rather than relying on jsdom to run a
 * real Google Maps script load) to unit-test MapView's *wiring*: what
 * `MapOptions` it constructs the map with, what marker icons it builds per
 * rank/variant/highlight state, the tap-to-highlight callback, bounds
 * fitting, and -- the most safety-relevant behavior for this increment --
 * that a rejected `importLibrary()` promise (simulating a real-world script-
 * load failure) is caught and results in the component rendering `null`
 * rather than crashing or leaving a broken panel on screen.
 *
 * Real-browser verification of the actual visual result (real colored pins
 * on real map tiles, the real muted style, real touch interaction) is NOT
 * possible in this sandbox without a real `GOOGLE_MAPS_JS_API_KEY` -- see
 * docs/test-report.md's INC-10 section, which flags this explicitly as a
 * still-open pre-launch item (same pattern as REV-010).
 *
 * All mock state lives inside vi.hoisted() -- vi.mock()'s factory is hoisted
 * above every other top-level statement in this file (including plain
 * `const` declarations), so anything the factory references must itself be
 * created inside vi.hoisted() to avoid a "used before initialization" error.
 */

const state = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
  const markerInstances: MockMarker[] = [];
  const polylineInstances: MockPolyline[] = [];

  class MockLatLngBounds {
    points: unknown[] = [];
    extend(point: unknown) {
      this.points.push(point);
    }
  }
  class MockSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  }
  class MockPoint {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }

  class MockMarker {
    position: unknown;
    icon: { url: string };
    map: unknown;
    listeners: Record<string, () => void> = {};
    removedListeners: string[] = [];
    constructor(opts: { position: unknown; map: unknown; icon: { url: string } }) {
      this.position = opts.position;
      this.icon = opts.icon;
      this.map = opts.map;
      markerInstances.push(this);
    }
    addListener(event: string, handler: () => void) {
      this.listeners[event] = handler;
      return {
        remove: () => {
          this.removedListeners.push(event);
        },
      };
    }
    setIcon(icon: { url: string }) {
      this.icon = icon;
    }
    setMap(map: unknown) {
      this.map = map;
    }
  }

  class MockPolyline {
    path: unknown;
    map: unknown;
    constructor(opts: { path: unknown; map: unknown }) {
      this.path = opts.path;
      this.map = opts.map;
      polylineInstances.push(this);
    }
    setMap(map: unknown) {
      this.map = map;
    }
  }

  class MockMap {
    options: Record<string, unknown>;
    fitBoundsCalls: Array<{ bounds: MockLatLngBounds; padding: unknown }> = [];
    center: unknown = null;
    zoom: number | null = null;
    constructor(_container: HTMLElement, opts: Record<string, unknown>) {
      this.options = opts;
      mapInstances.push(this);
    }
    fitBounds(bounds: MockLatLngBounds, padding: unknown) {
      this.fitBoundsCalls.push({ bounds, padding });
    }
    setCenter(center: unknown) {
      this.center = center;
    }
    setZoom(zoom: number) {
      this.zoom = zoom;
    }
  }

  let shouldFail = false;

  const setOptionsMock = vi.fn();
  const importLibraryMock = vi.fn(async (name: string) => {
    if (shouldFail) {
      throw new Error("mock Google Maps JavaScript API load failure");
    }
    if (name === "maps") return { Map: MockMap, Polyline: MockPolyline };
    if (name === "marker") return { Marker: MockMarker };
    if (name === "core") return { LatLngBounds: MockLatLngBounds, Size: MockSize, Point: MockPoint };
    throw new Error(`unexpected importLibrary("${name}") call`);
  });

  return {
    mapInstances,
    markerInstances,
    polylineInstances,
    setOptionsMock,
    importLibraryMock,
    setShouldFail(value: boolean) {
      shouldFail = value;
    },
  };
});

vi.mock("@googlemaps/js-api-loader", () => ({
  setOptions: state.setOptionsMock,
  importLibrary: state.importLibraryMock,
}));

import { MapView, type MapViewCandidate } from "../../src/frontend/components/MapView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mapInstances, markerInstances, polylineInstances, setOptionsMock, importLibraryMock } = state;

let container: HTMLDivElement;
let root: Root;

const ROUTE = [
  { lat: 43.6532, lng: -79.3832 },
  { lat: 43.7, lng: -79.4 },
];

const CANDIDATES: MapViewCandidate[] = [
  { rank: 1, location: { lat: 43.66, lng: -79.41 } },
  { rank: 2, location: { lat: 43.68, lng: -79.42 } },
];

/** Decodes MapView's data-URI SVG icon back to plain markup for content assertions. */
function decodeIcon(icon: { url: string }): string {
  const prefix = "data:image/svg+xml;charset=UTF-8,";
  return decodeURIComponent(icon.url.slice(prefix.length));
}

async function flush() {
  // Flushes the async init() effect's microtask chain (setOptions ->
  // Promise.all(importLibrary x3) -> destructuring). A macrotask tick is
  // more than sufficient and avoids over-fitting to a specific microtask
  // count.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderMap(overrides: Partial<ComponentProps<typeof MapView>> = {}) {
  const onSelectCandidate = overrides.onSelectCandidate ?? vi.fn();
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MapView
        route={ROUTE}
        candidates={CANDIDATES}
        variant="ranked"
        apiKey="test-gmaps-js-key"
        highlightedRank={null}
        onSelectCandidate={onSelectCandidate}
        {...overrides}
      />,
    );
    await flush();
  });
  return { onSelectCandidate };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mapInstances.length = 0;
  markerInstances.length = 0;
  polylineInstances.length = 0;
  setOptionsMock.mockClear();
  importLibraryMock.mockClear();
  state.setShouldFail(false);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  state.setShouldFail(false);
});

describe("MapView -- ux-spec.md section 6.7, INC-10 (FR-022, Google Maps JS API mocked, see file header)", () => {
  it("renders the map container with the correct accessibility role/label", async () => {
    await renderMap();
    const el = container.querySelector(".map-view");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("role")).toBe("img");
    expect(el!.getAttribute("aria-label")).toContain("route");
  });

  it("configurability: setOptions is called with the exact configured apiKey, not a hardcoded value", async () => {
    await renderMap({ apiKey: "a-completely-different-key" });
    expect(setOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ key: "a-completely-different-key" }));
  });

  it("a second, differently-configured render produces a different setOptions call -- proves the key isn't a fixed literal", async () => {
    await renderMap({ apiKey: "key-a" });
    expect(setOptionsMock).toHaveBeenLastCalledWith(expect.objectContaining({ key: "key-a" }));

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);

    await renderMap({ apiKey: "key-b" });
    expect(setOptionsMock).toHaveBeenLastCalledWith(expect.objectContaining({ key: "key-b" }));
  });

  it("item 3/4: initializes the map with disableDefaultUI true, zoomControl true, and the real MUTED_MAP_STYLE array wired in (not defined-but-unused)", async () => {
    const { MUTED_MAP_STYLE } = await import("../../src/frontend/components/mapStyle");
    await renderMap();
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0]!.options.disableDefaultUI).toBe(true);
    expect(mapInstances[0]!.options.zoomControl).toBe(true);
    expect(mapInstances[0]!.options.styles).toBe(MUTED_MAP_STYLE);
    expect((mapInstances[0]!.options.styles as unknown[]).length).toBeGreaterThan(0);
  });

  it("does NOT re-enable Street View, map-type control, or fullscreen control by omission -- only zoomControl is explicitly true, everything else is covered by disableDefaultUI", async () => {
    await renderMap();
    const opts = mapInstances[0]!.options;
    expect(opts.streetViewControl).not.toBe(true);
    expect(opts.mapTypeControl).not.toBe(true);
    expect(opts.fullscreenControl).not.toBe(true);
  });

  it("renders the route as a Polyline through the Maps JS API when the route has 2+ points", async () => {
    await renderMap();
    expect(polylineInstances).toHaveLength(1);
    expect(polylineInstances[0]!.path).toEqual(ROUTE);
    expect(polylineInstances[0]!.map).toBe(mapInstances[0]);
  });

  it("does not attempt to draw a polyline for an empty or single-point route (edge case)", async () => {
    await renderMap({ route: [] });
    expect(polylineInstances).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);

    await renderMap({ route: [{ lat: 1, lng: 2 }] });
    expect(polylineInstances).toHaveLength(0);
  });

  it("creates exactly one marker per candidate, at the correct lat/lng", async () => {
    await renderMap();
    expect(markerInstances).toHaveLength(2);
    expect(markerInstances[0]!.position).toEqual({ lat: 43.66, lng: -79.41 });
    expect(markerInstances[1]!.position).toEqual({ lat: 43.68, lng: -79.42 });
    expect(markerInstances[0]!.map).toBe(mapInstances[0]);
  });

  it("item 2: rank-1 marker gets a visually distinct icon from rank-2/3 in the 'ranked' variant (not a superficial claim -- checks actual fill color + label content)", async () => {
    await renderMap();
    const icon1 = decodeIcon(markerInstances[0]!.icon);
    const icon2 = decodeIcon(markerInstances[1]!.icon);

    expect(icon1).toContain(">#1<");
    expect(icon2).toContain(">#2<");
    // Distinct fill colors -- rank 1 is the brand-primary emphasis color,
    // other ranks get a neutral color, per ux-spec.md section 6.7's
    // "rank-1 uses color-brand-primary; ranks 2-3 use a neutral marker
    // color" decision.
    const fill1 = icon1.match(/fill="(#[0-9a-fA-F]+)" stroke=/)?.[1];
    const fill2 = icon2.match(/fill="(#[0-9a-fA-F]+)" stroke=/)?.[1];
    expect(fill1).toBeTruthy();
    expect(fill2).toBeTruthy();
    expect(fill1).not.toBe(fill2);
  });

  it("the fallback variant's single candidate gets the warning-colored fallback marker style ('!' label), distinct from the ranked rank-1 fill color, regardless of its rank number", async () => {
    await renderMap({ variant: "fallback", candidates: [{ rank: 1, location: { lat: 43.66, lng: -79.41 } }] });
    const icon = decodeIcon(markerInstances[0]!.icon);
    expect(icon).toContain(">!<");
    expect(icon).not.toContain(">#1<");
    const fallbackFill = icon.match(/fill="(#[0-9a-fA-F]+)" stroke=/)?.[1];

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    markerInstances.length = 0; // fresh mount below -- don't let the previous fallback marker leak into this assertion

    await renderMap();
    const rankedIcon1 = decodeIcon(markerInstances[0]!.icon);
    const rankedFill = rankedIcon1.match(/fill="(#[0-9a-fA-F]+)" stroke=/)?.[1];
    expect(fallbackFill).toBeTruthy();
    expect(rankedFill).toBeTruthy();
    expect(fallbackFill).not.toBe(rankedFill);
  });

  it("a marker matching the initial highlightedRank prop is rendered pre-highlighted (halo ring present)", async () => {
    await renderMap({ highlightedRank: 2 });
    const icon1 = decodeIcon(markerInstances[0]!.icon);
    const icon2 = decodeIcon(markerInstances[1]!.icon);
    expect(icon1).not.toContain("<circle cx=\"16\" cy=\"16\" r=\"17\"");
    expect(icon2).toContain("<circle cx=\"16\" cy=\"16\" r=\"17\"");
  });

  it("item 6: changing highlightedRank on a re-render calls setIcon on the correct marker with a new/distinct icon, WITHOUT remounting/re-creating the Map or any Marker", async () => {
    await renderMap({ highlightedRank: null });
    expect(markerInstances).toHaveLength(2);
    expect(mapInstances).toHaveLength(1);
    const iconsBefore = markerInstances.map((m) => m.icon.url);
    importLibraryMock.mockClear();

    await act(async () => {
      root.render(
        <MapView
          route={ROUTE}
          candidates={CANDIDATES}
          variant="ranked"
          apiKey="test-gmaps-js-key"
          highlightedRank={1}
          onSelectCandidate={vi.fn()}
        />,
      );
    });

    // No remount: no new Map/Marker instances created, no re-invocation of
    // the async loader (init()'s effect has an empty dep array).
    expect(mapInstances).toHaveLength(1);
    expect(markerInstances).toHaveLength(2);
    expect(importLibraryMock).not.toHaveBeenCalled();

    // The rank-1 marker's icon actually changed (setIcon was used, per the
    // dev's claim) and now shows the halo ring; rank-2's icon reverted to
    // unhighlighted.
    expect(markerInstances[0]!.icon.url).not.toBe(iconsBefore[0]);
    expect(decodeIcon(markerInstances[0]!.icon)).toContain("<circle cx=\"16\" cy=\"16\" r=\"17\"");
    expect(decodeIcon(markerInstances[1]!.icon)).not.toContain("<circle cx=\"16\" cy=\"16\" r=\"17\"");
  });

  it("clicking a marker invokes onSelectCandidate with that marker's rank", async () => {
    const { onSelectCandidate } = await renderMap();
    markerInstances[1]!.listeners.click?.();
    expect(onSelectCandidate).toHaveBeenCalledWith(2);
    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
  });

  it("fits the map bounds to the route + candidate points when both are present", async () => {
    await renderMap();
    expect(mapInstances[0]!.fitBoundsCalls).toHaveLength(1);
    const bounds = mapInstances[0]!.fitBoundsCalls[0]!.bounds;
    expect(bounds.points).toHaveLength(ROUTE.length + CANDIDATES.length);
  });

  it("falls back to a default view (does not crash) when there is no route and no candidates at all", async () => {
    await renderMap({ route: [], candidates: [] });
    expect(mapInstances[0]!.center).toEqual({ lat: 0, lng: 0 });
    expect(mapInstances[0]!.zoom).toBe(2);
    expect(mapInstances[0]!.fitBoundsCalls).toHaveLength(0);
  });

  it("cleans up markers/polyline/listeners on unmount (no leaked Google Maps instances)", async () => {
    await renderMap();
    const marker0 = markerInstances[0]!;
    const polyline0 = polylineInstances[0]!;
    act(() => {
      root.unmount();
    });
    expect(marker0.map).toBeNull();
    expect(polyline0.map).toBeNull();
    expect(marker0.removedListeners).toContain("click");
    // Re-create for afterEach's own unmount call, which is a no-op double-unmount.
    root = createRoot(container);
  });

  describe("item 5: async load-failure guard (the most safety-relevant claim -- a rejected importLibrary() promise, not a synchronous render error)", () => {
    it("renders null (map panel absent from the DOM) when the Google Maps JS API fails to load, with no uncaught exception", async () => {
      state.setShouldFail(true);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await renderMap();
      expect(container.querySelector(".map-view")).toBeNull();
      expect(container.innerHTML).toBe("");
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("does not throw synchronously and does not leave any Map/Marker/Polyline instances behind on a load failure", async () => {
      state.setShouldFail(true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(renderMap()).resolves.toBeDefined();
      expect(mapInstances).toHaveLength(0);
      expect(markerInstances).toHaveLength(0);
      expect(polylineInstances).toHaveLength(0);
      vi.restoreAllMocks();
    });
  });
});
