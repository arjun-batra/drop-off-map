import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INC-9: MapView.tsx renders real Leaflet, and Leaflet's SVG-based vector
 * layers (L.polyline) crash under jsdom -- confirmed independently (see
 * docs/test-report.md's INC-9 section for the exact reproduction):
 * `L.polyline(...).addTo(map)` throws "Cannot use 'in' operator to search
 * for '_leaflet_id' in null" because jsdom has no real SVG renderer for
 * Leaflet's default vector renderer to attach to. This is a jsdom/Leaflet
 * environment limitation, not a MapView code defect (the same component
 * renders correctly in a real browser -- see dev's Playwright walkthrough in
 * docs/handoff.md, and this QA pass's own Playwright verification, noted in
 * docs/test-report.md).
 *
 * So this file mocks the `leaflet` module itself (rather than relying on
 * jsdom to execute real Leaflet) to unit-test MapView's *wiring*: what it
 * calls L.tileLayer/L.polyline/L.marker/L.divIcon with, marker
 * class/variant/highlight logic, and the tap-to-highlight callback --
 * exactly the things that don't require a real renderer to verify.
 *
 * All mock state lives inside vi.hoisted() -- vi.mock()'s factory is hoisted
 * above every other top-level statement in this file (including plain
 * `const` declarations), so anything the factory references must itself be
 * created inside vi.hoisted() to avoid a "used before initialization" error.
 */

interface DivIconOptions {
  className: string;
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
}

interface MockMarker {
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getElement: ReturnType<typeof vi.fn>;
  clickHandler?: () => void;
}

const state = vi.hoisted(() => {
  const mockMapInstance = {
    fitBounds: vi.fn(),
    setView: vi.fn(),
    remove: vi.fn(),
  };
  const mockTileLayerInstance = { addTo: vi.fn() };
  const mockPolylineInstance = { addTo: vi.fn() };
  const mockMarkers: Array<{ latlng: [number, number]; icon: unknown; marker: unknown }> = [];

  const mockMapFn = vi.fn(() => mockMapInstance);
  const mockTileLayerFn = vi.fn(() => mockTileLayerInstance);
  const mockPolylineFn = vi.fn(() => mockPolylineInstance);
  const mockDivIconFn = vi.fn((options: unknown) => options);
  const mockMarkerFn = vi.fn((latlng: [number, number], options: { icon: { html: string } }) => {
    // Real Leaflet caches and returns the *same* DOM node on every
    // getElement() call for a given marker -- mirror that here (not a
    // fresh element derived from options.icon.html each time) so the
    // highlightedRank effect's later class-toggle on the cached node is
    // observable by a subsequent getElement() call in the test, exactly
    // like the real API.
    let cachedElement: HTMLDivElement | null = null;
    const marker: {
      addTo: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      getElement: ReturnType<typeof vi.fn>;
      clickHandler?: () => void;
    } = {
      addTo: vi.fn(() => marker),
      on: vi.fn((_event: string, handler: () => void) => {
        marker.clickHandler = handler;
      }),
      getElement: vi.fn(() => {
        if (!cachedElement) {
          cachedElement = document.createElement("div");
          cachedElement.innerHTML = options.icon.html;
        }
        return cachedElement;
      }),
    };
    mockMarkers.push({ latlng, icon: options.icon, marker });
    return marker;
  });

  return {
    mockMapInstance,
    mockTileLayerInstance,
    mockPolylineInstance,
    mockMarkers,
    mockMapFn,
    mockTileLayerFn,
    mockPolylineFn,
    mockMarkerFn,
    mockDivIconFn,
  };
});

vi.mock("leaflet", () => ({
  default: {
    map: state.mockMapFn,
    tileLayer: state.mockTileLayerFn,
    polyline: state.mockPolylineFn,
    marker: state.mockMarkerFn,
    divIcon: state.mockDivIconFn,
  },
}));

import { MapView, type MapViewCandidate } from "../../src/frontend/components/MapView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockMapInstance = state.mockMapInstance;
const mockTileLayerInstance = state.mockTileLayerInstance;
const mockPolylineInstance = state.mockPolylineInstance;
const mockMapFn = state.mockMapFn;
const mockTileLayerFn = state.mockTileLayerFn;
const mockPolylineFn = state.mockPolylineFn;
const mockMarkerFn = state.mockMarkerFn;
const mockMarkers = state.mockMarkers as Array<{ latlng: [number, number]; icon: DivIconOptions; marker: MockMarker }>;

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

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockMarkers.length = 0;
  mockMapFn.mockClear();
  mockTileLayerFn.mockClear();
  mockPolylineFn.mockClear();
  mockMarkerFn.mockClear();
  mockMapInstance.fitBounds.mockClear();
  mockMapInstance.setView.mockClear();
  mockMapInstance.remove.mockClear();
  mockTileLayerInstance.addTo.mockClear();
  mockPolylineInstance.addTo.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderMap(overrides: Partial<ComponentProps<typeof MapView>> = {}) {
  const onSelectCandidate = overrides.onSelectCandidate ?? vi.fn();
  act(() => {
    root = createRoot(container);
    root.render(
      <MapView
        route={ROUTE}
        candidates={CANDIDATES}
        variant="ranked"
        tileUrlTemplate="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        tileAttribution="© OpenStreetMap contributors © CARTO"
        highlightedRank={null}
        onSelectCandidate={onSelectCandidate}
        {...overrides}
      />,
    );
  });
  return { onSelectCandidate };
}

describe("MapView -- ux-spec.md section 6.7, INC-9 (leaflet mocked, see file header)", () => {
  it("renders the map container with the correct accessibility role/label", () => {
    renderMap();
    const el = container.querySelector(".map-view");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("role")).toBe("img");
    expect(el!.getAttribute("aria-label")).toContain("route");
  });

  it("configurability: tile layer is created with the exact configured URL template and attribution, not a hardcoded provider", () => {
    renderMap({
      tileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png",
      tileAttribution: "(c) Example Tiles Inc.",
    });
    expect(mockTileLayerFn).toHaveBeenCalledTimes(1);
    expect(mockTileLayerFn).toHaveBeenCalledWith(
      "https://tiles.example.org/{z}/{x}/{y}.png",
      expect.objectContaining({ attribution: "(c) Example Tiles Inc." }),
    );
    expect(mockTileLayerInstance.addTo).toHaveBeenCalledWith(mockMapInstance);
  });

  it("a second, differently-configured render produces a different tile-layer call -- proves the URL isn't a fixed literal", () => {
    renderMap({ tileUrlTemplate: "https://a.example.com/{z}/{x}/{y}.png" });
    expect(mockTileLayerFn).toHaveBeenLastCalledWith("https://a.example.com/{z}/{x}/{y}.png", expect.anything());

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);

    renderMap({ tileUrlTemplate: "https://b.example.com/{z}/{x}/{y}.png" });
    expect(mockTileLayerFn).toHaveBeenLastCalledWith("https://b.example.com/{z}/{x}/{y}.png", expect.anything());
  });

  it("renders the route polyline through Leaflet's polyline API when the route has 2+ points", () => {
    renderMap();
    expect(mockPolylineFn).toHaveBeenCalledTimes(1);
    expect(mockPolylineFn).toHaveBeenCalledWith(
      [
        [43.6532, -79.3832],
        [43.7, -79.4],
      ],
      expect.objectContaining({ weight: 4 }),
    );
    expect(mockPolylineInstance.addTo).toHaveBeenCalledWith(mockMapInstance);
  });

  it("does not attempt to draw a polyline for an empty or single-point route (edge case)", () => {
    renderMap({ route: [] });
    expect(mockPolylineFn).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);

    renderMap({ route: [{ lat: 1, lng: 2 }] });
    expect(mockPolylineFn).not.toHaveBeenCalled();
  });

  it("creates exactly one marker per candidate, at the correct lat/lng", () => {
    renderMap();
    expect(mockMarkerFn).toHaveBeenCalledTimes(2);
    expect(mockMarkers[0]!.latlng).toEqual([43.66, -79.41]);
    expect(mockMarkers[1]!.latlng).toEqual([43.68, -79.42]);
    expect(mockMarkers[0]!.marker.addTo).toHaveBeenCalledWith(mockMapInstance);
  });

  it("rank-1 marker gets the rank-1 visual treatment, distinct from other ranks, in the 'ranked' variant", () => {
    renderMap();
    expect(mockMarkers[0]!.icon.html).toContain("map-view__marker--rank-1");
    expect(mockMarkers[0]!.icon.html).toContain("#1");
    expect(mockMarkers[1]!.icon.html).toContain("map-view__marker--rank-other");
    expect(mockMarkers[1]!.icon.html).toContain("#2");
    expect(mockMarkers[1]!.icon.html).not.toContain("map-view__marker--rank-1");
  });

  it("the fallback variant's single candidate gets the warning-colored fallback marker style, not rank-1/rank-other, regardless of its rank number", () => {
    renderMap({ variant: "fallback", candidates: [{ rank: 1, location: { lat: 43.66, lng: -79.41 } }] });
    expect(mockMarkers[0]!.icon.html).toContain("map-view__marker--fallback");
    expect(mockMarkers[0]!.icon.html).not.toContain("map-view__marker--rank-1");
    expect(mockMarkers[0]!.icon.html).toContain("!");
  });

  it("a marker matching the initial highlightedRank prop is rendered pre-highlighted", () => {
    renderMap({ highlightedRank: 2 });
    expect(mockMarkers[0]!.icon.html).not.toContain("map-view__marker--highlighted");
    expect(mockMarkers[1]!.icon.html).toContain("map-view__marker--highlighted");
  });

  it("changing highlightedRank on a re-render toggles the --highlighted class on the correct marker's DOM element, without remounting/re-creating markers", () => {
    renderMap({ highlightedRank: null });
    expect(mockMarkerFn).toHaveBeenCalledTimes(2);

    act(() => {
      root.render(
        <MapView
          route={ROUTE}
          candidates={CANDIDATES}
          variant="ranked"
          tileUrlTemplate="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          tileAttribution="© OpenStreetMap contributors © CARTO"
          highlightedRank={1}
          onSelectCandidate={vi.fn()}
        />,
      );
    });

    // No remount -- markers aren't re-created (mount effect has an empty dep
    // array, matches the "remounts per-search via ResultsScreen's key" design).
    expect(mockMarkerFn).toHaveBeenCalledTimes(2);
    const rank1Element = mockMarkers[0]!.marker.getElement().querySelector(".map-view__marker");
    expect(rank1Element?.classList.contains("map-view__marker--highlighted")).toBe(true);
  });

  it("clicking a marker invokes onSelectCandidate with that marker's rank", () => {
    const { onSelectCandidate } = renderMap();
    mockMarkers[1]!.marker.clickHandler?.();
    expect(onSelectCandidate).toHaveBeenCalledWith(2);
    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
  });

  it("fits the map bounds to the route + candidate points when both are present", () => {
    renderMap();
    expect(mockMapInstance.fitBounds).toHaveBeenCalledTimes(1);
    const boundsArg = mockMapInstance.fitBounds.mock.calls[0]![0] as unknown[];
    expect(boundsArg.length).toBe(ROUTE.length + CANDIDATES.length);
    expect(mockMapInstance.setView).not.toHaveBeenCalled();
  });

  it("falls back to a default view (does not crash) when there is no route and no candidates at all", () => {
    renderMap({ route: [], candidates: [] });
    expect(mockMapInstance.setView).toHaveBeenCalledTimes(1);
    expect(mockMapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it("removes the map instance on unmount (no leaked Leaflet instance)", () => {
    renderMap();
    act(() => {
      root.unmount();
    });
    expect(mockMapInstance.remove).toHaveBeenCalledTimes(1);
    // Re-create for afterEach's own unmount call, which is a no-op double-unmount.
    root = createRoot(container);
  });
});
