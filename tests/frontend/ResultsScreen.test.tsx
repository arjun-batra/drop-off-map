import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicConfig } from "../../src/config/schema";
import { ResultsScreen } from "../../src/frontend/components/ResultsScreen";
import type { DropOffSearchRequest, DropOffSearchResponse } from "../../src/search/types";

// INC-9: MapView renders real Leaflet, which crashes in jsdom (no SVG
// renderer support -- confirmed independently: L.polyline().addTo(map)
// throws "Cannot use 'in' operator to search for '_leaflet_id' in null"
// under jsdom, a jsdom/Leaflet environment limitation, not a code defect --
// see docs/test-report.md's INC-9 section). ResultsScreen's own tests mock
// MapView out entirely so they can verify the *composition* (when the panel
// is shown/hidden, what props it receives, the tap-to-highlight wiring) --
// MapView's own internal Leaflet wiring (tile layer, markers, marker
// variants, polyline) is covered separately in MapView.test.tsx, which mocks
// the `leaflet` module itself instead of relying on jsdom to run real Leaflet.
//
// `mockMapViewSpy` (name starts with "mock", per Vitest's hoisting
// convention) is safe to reference inside the vi.mock factory below even
// though vi.mock calls are hoisted above all imports/other statements.
const mockMapViewSpy = vi.fn();
vi.mock("../../src/frontend/components/MapView", () => ({
  MapView: (props: {
    route: Array<{ lat: number; lng: number }>;
    candidates: Array<{ rank: number; location: { lat: number; lng: number } }>;
    variant: "ranked" | "fallback";
    tileUrlTemplate: string;
    tileAttribution: string;
    onSelectCandidate: (rank: number) => void;
  }) => {
    mockMapViewSpy(props);
    return (
      <div data-testid="mock-map-view" data-variant={props.variant} data-candidate-count={props.candidates.length}>
        {props.candidates.map((c) => (
          <button key={c.rank} data-testid={`mock-pin-${c.rank}`} onClick={() => props.onSelectCandidate(c.rank)}>
            pin {c.rank}
          </button>
        ))}
      </div>
    );
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAP_CONFIG: Pick<PublicConfig, "mapTileUrlTemplate" | "mapTileAttribution"> = {
  mapTileUrlTemplate: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  mapTileAttribution: "© OpenStreetMap contributors © CARTO",
};

const NO_MAP_CONFIG: Pick<PublicConfig, "mapTileUrlTemplate" | "mapTileAttribution"> = {
  mapTileUrlTemplate: null,
  mapTileAttribution: null,
};

const ROUTE = [
  { lat: 43.6532, lng: -79.3832 },
  { lat: 43.7, lng: -79.4 },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockMapViewSpy.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const REQUEST: DropOffSearchRequest = {
  start: { lat: 43.6532, lng: -79.3832, label: "123 Elm St" },
  driverDestination: { lat: 43.75, lng: -79.4, label: "456 Bay St" },
  passengerDestination: { lat: 43.78, lng: -79.42, label: "789 King St" },
  maxDetourMinutes: 15,
};

function render(
  response: DropOffSearchResponse,
  onEditSearch = vi.fn(),
  onTryAgain = vi.fn(),
  mapConfig: Pick<PublicConfig, "mapTileUrlTemplate" | "mapTileAttribution"> = MAP_CONFIG,
) {
  act(() => {
    root = createRoot(container);
    root.render(
      <ResultsScreen
        response={response}
        request={REQUEST}
        onEditSearch={onEditSearch}
        onTryAgain={onTryAgain}
        mapConfig={mapConfig}
      />,
    );
  });
}

describe("ResultsScreen -- ux-spec.md section 6, FR-010/FR-011/FR-012/FR-013", () => {
  it("ranked: renders each candidate card with rank badge, BEST OPTION on #1 only, and the full FR-013 time breakdown", () => {
    const response: DropOffSearchResponse = {
      status: "ranked",
      candidates: [
        {
          rank: 1,
          location: { lat: 43.66, lng: -79.4 },
          label: "Oak Ave & Main St",
          routeOrderIndex: 3,
          driveTimeToDropoffMinutes: 8,
          detourMinutes: 3,
          walkTimeMinutes: 4,
          waitTimeMinutes: 5,
          transitTimeMinutes: 17,
          passengerTotalTimeMinutes: 26,
          driverTotalTimeMinutes: 27,
          exceedsThreshold: false,
        },
        {
          rank: 2,
          location: { lat: 43.67, lng: -79.41 },
          label: "Elm St & 2nd Ave",
          routeOrderIndex: 5,
          driveTimeToDropoffMinutes: 9,
          detourMinutes: 4,
          walkTimeMinutes: 6,
          waitTimeMinutes: 6,
          transitTimeMinutes: 18,
          passengerTotalTimeMinutes: 30,
          driverTotalTimeMinutes: 29,
          exceedsThreshold: false,
        },
      ],
      requestId: "r1",
      timingMs: 1200,
    };
    render(response);

    expect(container.textContent).toContain("Oak Ave & Main St");
    expect(container.textContent).toContain("BEST OPTION");
    expect(container.textContent).toContain("+3 min");
    expect(container.textContent).toContain("27 min");
    expect(container.textContent).toContain("26 min");

    const cards = container.querySelectorAll(".results-screen__card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("BEST OPTION");
    expect(cards[1]!.textContent).not.toContain("BEST OPTION");
  });

  it("ranked: rounds sub-minute time values to the nearest minute per ux-spec.md section 6.4", () => {
    const response: DropOffSearchResponse = {
      status: "ranked",
      candidates: [
        {
          rank: 1,
          location: { lat: 43.66, lng: -79.4 },
          label: "Somewhere",
          routeOrderIndex: 0,
          driveTimeToDropoffMinutes: 8.4,
          detourMinutes: 2.6,
          walkTimeMinutes: 3.5,
          waitTimeMinutes: 4.2,
          transitTimeMinutes: 10.1,
          passengerTotalTimeMinutes: 17.8,
          driverTotalTimeMinutes: 20.9,
          exceedsThreshold: false,
        },
      ],
      requestId: "r1",
      timingMs: 500,
    };
    render(response);
    expect(container.textContent).toContain("+3 min"); // 2.6 rounds to 3
    expect(container.textContent).toContain("21 min"); // 20.9 rounds to 21
    expect(container.textContent).toContain("18 min"); // 17.8 rounds to 18
  });

  it("fallback: renders exactly one card labeled CLOSEST OPTION, no BEST OPTION, warning banner visible, danger-colored detour row", () => {
    const response: DropOffSearchResponse = {
      status: "fallback",
      candidates: [
        {
          rank: 1,
          location: { lat: 43.66, lng: -79.4 },
          label: "Far Depot Rd",
          routeOrderIndex: 1,
          driveTimeToDropoffMinutes: 20,
          detourMinutes: 40,
          walkTimeMinutes: 2,
          waitTimeMinutes: 1,
          transitTimeMinutes: 5,
          passengerTotalTimeMinutes: 8,
          driverTotalTimeMinutes: 45,
          exceedsThreshold: true,
        },
      ],
      warning: "None of the drop-off points found keep your detour under 15 minutes. Here's the option that gets your passenger there fastest anyway — it adds 40 minutes.",
      requestId: "r1",
      timingMs: 900,
    };
    render(response);

    const cards = container.querySelectorAll(".results-screen__card");
    expect(cards).toHaveLength(1);
    expect(container.textContent).toContain("CLOSEST OPTION");
    expect(container.textContent).not.toContain("BEST OPTION");
    expect(container.textContent).toContain("None of the drop-off points found");

    const dangerValue = container.querySelector(".results-screen__row-value--danger");
    expect(dangerValue).not.toBeNull();
    expect(dangerValue!.textContent).toBe("+40 min");
  });

  it("no_viable_option: renders the empty state with the server-provided message, no cards", () => {
    const response: DropOffSearchResponse = {
      status: "no_viable_option",
      candidates: [],
      message: "We couldn't find a route with transit access to the passenger's destination along this trip.",
      requestId: "r1",
      timingMs: 300,
    };
    render(response);

    expect(container.querySelectorAll(".results-screen__card")).toHaveLength(0);
    expect(container.textContent).toContain("No drop-off points found");
    expect(container.textContent).toContain("We couldn't find a route with transit access");
  });

  it("timeout (INC-7, design.md section 6.3/8): renders a distinct 'taking longer than expected' empty state, no cards, and a 'Try again' button that invokes onTryAgain", () => {
    const response: DropOffSearchResponse = {
      status: "timeout",
      candidates: [],
      message: "This is taking longer than expected. Please try again in a moment.",
      requestId: "r1",
      timingMs: 5000,
    };
    const onTryAgain = vi.fn();
    render(response, vi.fn(), onTryAgain);

    expect(container.querySelectorAll(".results-screen__card")).toHaveLength(0);
    expect(container.textContent).toContain("This is taking longer than expected");
    expect(container.textContent).toContain("This is taking longer than expected. Please try again in a moment.");

    const tryAgainButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    );
    expect(tryAgainButton).toBeTruthy();
    act(() => {
      tryAgainButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("'Try again' button is NOT shown on the other three message-only statuses (no_viable_option/out_of_service_area/invalid_input) -- only 'timeout' invites a retry", () => {
    const statuses: DropOffSearchResponse["status"][] = ["no_viable_option", "out_of_service_area", "invalid_input"];
    for (const status of statuses) {
      render({ status, candidates: [], message: "some message", requestId: "r1", timingMs: 1 });
      const tryAgainButton = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Try again",
      );
      expect(tryAgainButton).toBeUndefined();
      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
    }
  });

  it("out_of_service_area (defense-in-depth path): renders an empty state with the message, does not crash", () => {
    const response: DropOffSearchResponse = {
      status: "out_of_service_area",
      candidates: [],
      message: "This trip falls outside our service area (within 200 km of Toronto, ON).",
      requestId: "r1",
      timingMs: 100,
    };
    render(response);

    expect(container.querySelectorAll(".results-screen__card")).toHaveLength(0);
    expect(container.textContent).toContain("This trip falls outside our service area");
  });

  it("invalid_input (defense-in-depth path): renders an empty state with the message, does not crash", () => {
    const response: DropOffSearchResponse = {
      status: "invalid_input",
      candidates: [],
      message: "One or more required fields are missing or invalid.",
      requestId: "r1",
      timingMs: 50,
    };
    render(response);

    expect(container.querySelectorAll(".results-screen__card")).toHaveLength(0);
    expect(container.textContent).toContain("One or more required fields are missing");
  });

  it("FR-014/REV-012: ResultsScreen itself never renders the disclaimer -- it is deliberately rendered one level up, in SearchFlow.tsx, as a sibling outside the ErrorBoundary that wraps this component (see SearchFlow.test.tsx for the resilience composition test)", () => {
    const statuses: DropOffSearchResponse[] = [
      {
        status: "ranked",
        candidates: [
          {
            rank: 1,
            location: { lat: 43.66, lng: -79.4 },
            label: "X",
            routeOrderIndex: 0,
            driveTimeToDropoffMinutes: 1,
            detourMinutes: 1,
            walkTimeMinutes: 1,
            waitTimeMinutes: 1,
            transitTimeMinutes: 1,
            passengerTotalTimeMinutes: 3,
            driverTotalTimeMinutes: 2,
            exceedsThreshold: false,
          },
        ],
        requestId: "r1",
        timingMs: 1,
      },
      { status: "no_viable_option", candidates: [], message: "msg", requestId: "r2", timingMs: 1 },
    ];

    for (const response of statuses) {
      render(response);
      expect(container.textContent).not.toContain("estimated drop-off point");
      expect(container.textContent).not.toContain("safe and legal");
      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
    }
  });

  it("'Edit search' link invokes the onEditSearch callback", () => {
    const onEditSearch = vi.fn();
    const response: DropOffSearchResponse = {
      status: "no_viable_option",
      candidates: [],
      message: "msg",
      requestId: "r1",
      timingMs: 1,
    };
    render(response, onEditSearch);

    const link = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Edit search"));
    act(() => {
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onEditSearch).toHaveBeenCalledTimes(1);
  });

  it("trip summary shows the resolved request labels, not raw coordinates", () => {
    const response: DropOffSearchResponse = {
      status: "no_viable_option",
      candidates: [],
      message: "msg",
      requestId: "r1",
      timingMs: 1,
    };
    render(response);
    expect(container.textContent).toContain("123 Elm St");
    expect(container.textContent).toContain("456 Bay St");
    expect(container.textContent).toContain("789 King St");
  });

  describe("Map view (ux-spec.md section 6.7, INC-9)", () => {
    const RANKED_CANDIDATE = {
      rank: 1,
      location: { lat: 43.66, lng: -79.4 },
      label: "Oak Ave & Main St",
      routeOrderIndex: 3,
      driveTimeToDropoffMinutes: 8,
      detourMinutes: 3,
      walkTimeMinutes: 4,
      waitTimeMinutes: 5,
      transitTimeMinutes: 17,
      passengerTotalTimeMinutes: 26,
      driverTotalTimeMinutes: 27,
      exceedsThreshold: false,
    };

    const RANKED_RESPONSE: DropOffSearchResponse = {
      status: "ranked",
      candidates: [RANKED_CANDIDATE, { ...RANKED_CANDIDATE, rank: 2, label: "Elm St & 2nd Ave" }],
      requestId: "r1",
      timingMs: 1200,
      route: ROUTE,
    };

    const FALLBACK_RESPONSE: DropOffSearchResponse = {
      status: "fallback",
      candidates: [{ ...RANKED_CANDIDATE, exceedsThreshold: true }],
      warning: "None of the drop-off points found keep your detour under 15 minutes.",
      requestId: "r1",
      timingMs: 900,
      route: ROUTE,
    };

    it("renders the map panel on a ranked response with a route and tile config present, passing the correct route/candidates/variant through", () => {
      render(RANKED_RESPONSE);
      const mapEl = container.querySelector('[data-testid="mock-map-view"]');
      expect(mapEl).not.toBeNull();
      expect(mapEl!.getAttribute("data-variant")).toBe("ranked");
      expect(mapEl!.getAttribute("data-candidate-count")).toBe("2");
      expect(mockMapViewSpy).toHaveBeenCalledTimes(1);
      const props = mockMapViewSpy.mock.calls[0]![0] as {
        route: unknown;
        tileUrlTemplate: string;
        tileAttribution: string;
      };
      expect(props.route).toEqual(ROUTE);
      expect(props.tileUrlTemplate).toBe(MAP_CONFIG.mapTileUrlTemplate);
      expect(props.tileAttribution).toBe(MAP_CONFIG.mapTileAttribution);
    });

    it("renders the map panel on a fallback response, with the 'fallback' variant and exactly one candidate", () => {
      render(FALLBACK_RESPONSE);
      const mapEl = container.querySelector('[data-testid="mock-map-view"]');
      expect(mapEl).not.toBeNull();
      expect(mapEl!.getAttribute("data-variant")).toBe("fallback");
      expect(mapEl!.getAttribute("data-candidate-count")).toBe("1");
    });

    it("configurability: a differently-configured tile provider is passed through, not a hardcoded URL/attribution", () => {
      const customConfig = {
        mapTileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png",
        mapTileAttribution: "(c) Example Tiles Inc.",
      };
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), customConfig);
      const props = mockMapViewSpy.mock.calls[0]![0] as { tileUrlTemplate: string; tileAttribution: string };
      expect(props.tileUrlTemplate).toBe(customConfig.mapTileUrlTemplate);
      expect(props.tileAttribution).toBe(customConfig.mapTileAttribution);
    });

    it("gracefully omits the map (not shown broken) on no_viable_option, even though tile config is present -- there is nothing to plot", () => {
      render({ status: "no_viable_option", candidates: [], message: "msg", requestId: "r1", timingMs: 1 });
      expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
      expect(mockMapViewSpy).not.toHaveBeenCalled();
    });

    it("gracefully omits the map on out_of_service_area/invalid_input/timeout as well", () => {
      const statuses: DropOffSearchResponse["status"][] = ["out_of_service_area", "invalid_input", "timeout"];
      for (const status of statuses) {
        render({ status, candidates: [], message: "msg", requestId: "r1", timingMs: 1 });
        expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
        act(() => root.unmount());
        container.remove();
        container = document.createElement("div");
        document.body.appendChild(container);
      }
    });

    it("gracefully omits the map when the tile provider isn't configured (mapTileUrlTemplate/mapTileAttribution null), while the candidate cards still render fine", () => {
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), NO_MAP_CONFIG);
      expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
      expect(mockMapViewSpy).not.toHaveBeenCalled();
      // Cards must still render normally -- the map is the *only* thing
      // gated by tile config, not the rest of the Results screen.
      expect(container.querySelectorAll(".results-screen__card")).toHaveLength(2);
      expect(container.textContent).toContain("Oak Ave & Main St");
    });

    it("gracefully omits the map when only one of the two tile-config values is set (belt-and-suspenders -- both must be present)", () => {
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), {
        mapTileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png",
        mapTileAttribution: null,
      });
      expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
    });

    it("gracefully omits the map on a ranked/fallback response with no route field at all (defensive, belt-and-suspenders check), while cards still render", () => {
      const responseWithoutRoute: DropOffSearchResponse = { ...RANKED_RESPONSE, route: undefined };
      render(responseWithoutRoute);
      expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
      expect(container.querySelectorAll(".results-screen__card")).toHaveLength(2);
    });

    it("tap-to-highlight: clicking a map pin flashes/scrolls the matching card, not a different one", () => {
      render(RANKED_RESPONSE);
      const scrollSpy = vi.fn();
      const card2 = document.getElementById("results-screen-card-2")!;
      card2.scrollIntoView = scrollSpy;
      const card1 = document.getElementById("results-screen-card-1")!;
      card1.scrollIntoView = vi.fn();

      const pin2 = container.querySelector('[data-testid="mock-pin-2"]') as HTMLButtonElement;
      act(() => {
        pin2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(card2.className).toContain("results-screen__card--flash");
      expect(card1.className).not.toContain("results-screen__card--flash");
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it("tapping a card does not re-center the map (one-directional interaction only, per ux-spec.md section 6.7) -- no onSelectCandidate call originates from a card click", () => {
      render(RANKED_RESPONSE);
      mockMapViewSpy.mockClear();
      const card1 = document.getElementById("results-screen-card-1")!;
      act(() => {
        card1.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // No re-render of MapView with different props should be triggered by
      // a card click alone (highlightedRank only changes via a pin click).
      expect(mockMapViewSpy).not.toHaveBeenCalled();
    });
  });
});
