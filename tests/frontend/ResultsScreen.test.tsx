import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicConfig } from "../../src/config/schema";
import { ResultsScreen } from "../../src/frontend/components/ResultsScreen";
import type { DropOffSearchCandidate, DropOffSearchRequest, DropOffSearchResponse } from "../../src/search/types";

// INC-10: MapView renders via Google's Maps JavaScript API, loaded
// asynchronously through @googlemaps/js-api-loader -- no real key/network is
// available in this test environment. ResultsScreen's own tests mock
// MapView out entirely so they can verify the *composition* (when the panel
// is shown/hidden, what props it receives, the tap-to-highlight wiring) --
// MapView's own internal Google Maps JS API wiring (custom markers, muted
// style, disableDefaultUI/zoomControl, async-load-failure guard, polyline)
// is covered separately in MapView.test.tsx, which mocks
// `@googlemaps/js-api-loader` itself instead of relying on jsdom to run a
// real Google Maps script load.
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
    apiKey: string;
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

const MAP_CONFIG: Pick<PublicConfig, "googleMapsJsApiKey"> = {
  googleMapsJsApiKey: "test-gmaps-js-key",
};

const NO_MAP_CONFIG: Pick<PublicConfig, "googleMapsJsApiKey"> = {
  googleMapsJsApiKey: null,
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
  avoidTolls: false,
};

function render(
  response: DropOffSearchResponse,
  onEditSearch = vi.fn(),
  onTryAgain = vi.fn(),
  mapConfig: Pick<PublicConfig, "googleMapsJsApiKey"> = MAP_CONFIG,
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
  it("ranked: renders each candidate card with rank badge, TOP PICK on #1 only, and the full FR-013 time breakdown", () => {
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
    expect(container.textContent).toContain("TOP PICK");
    expect(container.textContent).toContain("+3 min");
    expect(container.textContent).toContain("27 min");
    expect(container.textContent).toContain("26 min");

    const cards = container.querySelectorAll(".results-screen__card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("TOP PICK");
    expect(cards[1]!.textContent).not.toContain("TOP PICK");
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

  it("fallback: renders exactly one card labeled CLOSEST OPTION, no TOP PICK, warning banner visible, danger-colored detour row", () => {
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
    expect(container.textContent).not.toContain("TOP PICK");
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

  it("'Try again' button is NOT shown on the other message-only statuses (no_viable_option/out_of_service_area/invalid_input/no_toll_free_route) -- only 'timeout' invites a retry", () => {
    const statuses: DropOffSearchResponse["status"][] = [
      "no_viable_option",
      "out_of_service_area",
      "invalid_input",
      "no_toll_free_route",
    ];
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

  it("no_toll_free_route (FR-018/OQ-9, INC-13, ux-spec.md section 6.6a): renders the 'No toll-free route found' empty state with the server-provided message, no cards, no map, no 'Try again' button", () => {
    const response: DropOffSearchResponse = {
      status: "no_toll_free_route",
      candidates: [],
      message:
        "We couldn't find a route that avoids tolls for this trip. Uncheck \"Avoid tolls\" to see toll-inclusive options, or try a different start or destination.",
      requestId: "r1",
      timingMs: 200,
    };
    render(response);

    expect(container.querySelectorAll(".results-screen__card")).toHaveLength(0);
    expect(container.textContent).toContain("No toll-free route found");
    expect(container.textContent).toContain("We couldn't find a route that avoids tolls");
    expect(mockMapViewSpy).not.toHaveBeenCalled();

    const tryAgainButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    );
    expect(tryAgainButton).toBeUndefined();

    // Only "← Edit search" is offered (ux-spec.md section 6.6a's explicit precedent-match to no_viable_option).
    const editButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Edit search"),
    );
    expect(editButton).toBeTruthy();
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

  describe("Map view (ux-spec.md section 6.7, INC-10/FR-022)", () => {
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

    it("renders the map panel on a ranked response with a route and API key present, passing the correct route/candidates/variant/apiKey through", () => {
      render(RANKED_RESPONSE);
      const mapEl = container.querySelector('[data-testid="mock-map-view"]');
      expect(mapEl).not.toBeNull();
      expect(mapEl!.getAttribute("data-variant")).toBe("ranked");
      expect(mapEl!.getAttribute("data-candidate-count")).toBe("2");
      expect(mockMapViewSpy).toHaveBeenCalledTimes(1);
      const props = mockMapViewSpy.mock.calls[0]![0] as {
        route: unknown;
        apiKey: string;
      };
      expect(props.route).toEqual(ROUTE);
      expect(props.apiKey).toBe(MAP_CONFIG.googleMapsJsApiKey);
    });

    it("renders the map panel on a fallback response, with the 'fallback' variant and exactly one candidate", () => {
      render(FALLBACK_RESPONSE);
      const mapEl = container.querySelector('[data-testid="mock-map-view"]');
      expect(mapEl).not.toBeNull();
      expect(mapEl!.getAttribute("data-variant")).toBe("fallback");
      expect(mapEl!.getAttribute("data-candidate-count")).toBe("1");
    });

    it("configurability: a differently-configured GOOGLE_MAPS_JS_API_KEY is passed through, not a hardcoded value", () => {
      const customConfig = { googleMapsJsApiKey: "a-completely-different-key-789" };
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), customConfig);
      const props = mockMapViewSpy.mock.calls[0]![0] as { apiKey: string };
      expect(props.apiKey).toBe(customConfig.googleMapsJsApiKey);
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

    it("gracefully omits the map when GOOGLE_MAPS_JS_API_KEY isn't configured (null), while the candidate cards still render fine", () => {
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), NO_MAP_CONFIG);
      expect(container.querySelector('[data-testid="mock-map-view"]')).toBeNull();
      expect(mockMapViewSpy).not.toHaveBeenCalled();
      // Cards must still render normally -- the map is the *only* thing
      // gated by the API key, not the rest of the Results screen.
      expect(container.querySelectorAll(".results-screen__card")).toHaveLength(2);
      expect(container.textContent).toContain("Oak Ave & Main St");
    });

    it("gracefully omits the map when GOOGLE_MAPS_JS_API_KEY is an empty string (falsy, treated the same as unset)", () => {
      render(RANKED_RESPONSE, vi.fn(), vi.fn(), { googleMapsJsApiKey: "" });
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

  describe("Card redesign + FR-021 stop detail + expand/collapse (ux-spec.md section 6.4/6.4b, INC-12)", () => {
    const RANK1_WITH_STOPS: DropOffSearchCandidate = {
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
      boardingStop: {
        name: "Oak Ave & Main St",
        location: { lat: 43.66, lng: -79.4 },
        lineName: "506",
        headsign: "Downtown Loop",
      },
      arrivalStop: {
        name: "Bay St Station",
        location: { lat: 43.7, lng: -79.38 },
        lineName: "506",
        headsign: "Downtown Loop",
      },
    };

    const RANK2_WITH_STOPS: DropOffSearchCandidate = {
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
      boardingStop: {
        name: "Elm St & 5th Ave",
        location: { lat: 43.67, lng: -79.41 },
        lineName: "12",
        headsign: "Airport Express",
      },
      arrivalStop: {
        name: "King St Loop",
        location: { lat: 43.72, lng: -79.39 },
        lineName: "12",
        headsign: "Airport Express",
      },
    };

    const RANK3_WALKING_ONLY: DropOffSearchCandidate = {
      rank: 3,
      location: { lat: 43.68, lng: -79.42 },
      label: "King St & River Rd",
      routeOrderIndex: 8,
      driveTimeToDropoffMinutes: 10,
      detourMinutes: 2,
      walkTimeMinutes: 12,
      waitTimeMinutes: 0,
      transitTimeMinutes: 0,
      passengerTotalTimeMinutes: 12,
      driverTotalTimeMinutes: 20,
      exceedsThreshold: false,
      // boardingStop/arrivalStop deliberately absent -- DEC-3 walking-only.
    };

    const RESPONSE_WITH_STOPS: DropOffSearchResponse = {
      status: "ranked",
      candidates: [RANK1_WITH_STOPS, RANK2_WITH_STOPS, RANK3_WALKING_ONLY],
      requestId: "r1",
      timingMs: 1200,
    };

    function card(rank: number): HTMLElement {
      return document.getElementById(`results-screen-card-${rank}`) as HTMLElement;
    }

    function toggle(rank: number): HTMLElement {
      return card(rank).querySelector(".results-screen__card-toggle") as HTMLElement;
    }

    it("rank 1 (top pick) is forced-expanded: no role=button/tabIndex/aria-expanded on its header, and shows the full FR-021 itinerary with REAL data substituted, not literal placeholder text", () => {
      render(RESPONSE_WITH_STOPS);

      const t = toggle(1);
      expect(t.getAttribute("role")).toBeNull();
      expect(t.hasAttribute("tabindex")).toBe(false);
      expect(t.hasAttribute("aria-expanded")).toBe(false);
      expect(card(1).querySelector(".results-screen__chevron")).toBeNull();

      const text = card(1).textContent!;
      expect(text).toContain("Walk to Oak Ave & Main St");
      expect(text).toContain("Board 506 → Downtown Loop");
      expect(text).toContain("Arrive at Bay St Station");
      expect(text).toContain("TOP PICK");
      // Never literal placeholder text.
      expect(text).not.toContain("{boardingStop.name}");
      expect(text).not.toContain("{lineName}");
      expect(text).not.toContain("{headsign}");
      expect(text).not.toContain("undefined");
    });

    it("ranks 2/3 are collapsed by default (aria-expanded=false), and the full itinerary is NOT in the DOM's text until expanded", () => {
      render(RESPONSE_WITH_STOPS);

      const t2 = toggle(2);
      expect(t2.getAttribute("role")).toBe("button");
      expect(t2.getAttribute("tabindex")).toBe("0");
      expect(t2.getAttribute("aria-expanded")).toBe("false");
      expect(card(2).className).toContain("results-screen__card--collapsed");
      expect(card(2).textContent).not.toContain("Board ");
      expect(card(2).textContent).not.toContain("Walk to Elm St & 5th Ave");
      // Collapsed headline uses the smaller (non type-metric) treatment + "total" caption.
      expect(card(2).textContent).toContain("total");
      expect(card(2).textContent).not.toContain("total for your passenger");
    });

    it("clicking a collapsed card's toggle expands it in place, revealing rank 2's OWN boarding/arrival stop detail (not rank 1's)", () => {
      render(RESPONSE_WITH_STOPS);
      const t2 = toggle(2);

      act(() => {
        t2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(t2.getAttribute("aria-expanded")).toBe("true");
      expect(card(2).className).toContain("results-screen__card--expanded");
      const text = card(2).textContent!;
      expect(text).toContain("Walk to Elm St & 5th Ave");
      expect(text).toContain("Board 12 → Airport Express");
      expect(text).toContain("Arrive at King St Loop");
      // Confirms no data bleed from rank 1.
      expect(text).not.toContain("Oak Ave & Main St");
      expect(text).not.toContain("Downtown Loop");
    });

    it("clicking an already-expanded (manually toggled) card collapses it back", () => {
      render(RESPONSE_WITH_STOPS);
      const t2 = toggle(2);
      act(() => t2.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(t2.getAttribute("aria-expanded")).toBe("true");
      act(() => t2.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(t2.getAttribute("aria-expanded")).toBe("false");
      expect(card(2).textContent).not.toContain("Board 12");
    });

    it("keyboard-operable: pressing Enter on a collapsed card's toggle expands it (real aria-expanded state change, not just a visual class)", () => {
      render(RESPONSE_WITH_STOPS);
      const t3 = toggle(3);
      expect(t3.getAttribute("aria-expanded")).toBe("false");

      act(() => {
        t3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });

      expect(t3.getAttribute("aria-expanded")).toBe("true");
    });

    it("keyboard-operable: pressing Space on an expanded card's toggle collapses it back", () => {
      render(RESPONSE_WITH_STOPS);
      const t3 = toggle(3);
      act(() => t3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(t3.getAttribute("aria-expanded")).toBe("true");

      act(() => {
        t3.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      });

      expect(t3.getAttribute("aria-expanded")).toBe("false");
    });

    it("a key other than Enter/Space on a toggle does not change aria-expanded", () => {
      render(RESPONSE_WITH_STOPS);
      const t2 = toggle(2);
      act(() => {
        t2.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      });
      expect(t2.getAttribute("aria-expanded")).toBe("false");
    });

    it("DEC-3 walking-only candidate (rank 3), once expanded, shows 'Walk to destination' and never contains 'Board ' anywhere in the card", () => {
      render(RESPONSE_WITH_STOPS);
      const t3 = toggle(3);
      act(() => t3.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      const text = card(3).textContent!;
      expect(text).toContain("Walk to destination");
      expect(text).not.toContain("Board ");
      expect(text).not.toContain("Arrive at");
      // The journey strip's transit icon is omitted for a walking-only candidate.
      expect(card(3).querySelector(".results-screen__journey-step--transit")).toBeNull();
    });

    it("a real-transit candidate's journey strip includes the transit icon step (present for non-walking-only candidates)", () => {
      render(RESPONSE_WITH_STOPS);
      expect(card(1).querySelector(".results-screen__journey-step--transit")).not.toBeNull();
    });

    it("collapsed cards' journey strip shows icons only, with no per-leg minute labels (per section 6.4's icons-only collapsed rule)", () => {
      render(RESPONSE_WITH_STOPS);
      const strip = card(2).querySelector(".results-screen__journey-strip")!;
      // No type-body-small per-leg minute spans while collapsed.
      expect(strip.querySelectorAll(".type-body-small")).toHaveLength(0);
      // But the icons themselves are present (decorative svgs).
      expect(strip.querySelectorAll("svg").length).toBeGreaterThan(0);
    });

    it("every candidate's icons are paired with a visible text label somewhere on the card (ux-spec.md section 2.6's 'never icon-alone' rule) -- spot-checked via aria-hidden icons plus adjacent visible text", () => {
      render(RESPONSE_WITH_STOPS);
      // All icons in this component are aria-hidden (decorative) -- the
      // accompanying visible text is the card's own labeled rows/pills,
      // already asserted above (Walk to/Board/Arrive at). Confirm no icon
      // carries an accessible name of its own that would suggest it's being
      // used as the sole information carrier.
      const icons = card(1).querySelectorAll("svg[aria-hidden='true']");
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.getAttribute("aria-label")).toBeNull();
      }
    });

    it("the fallback card (single candidate) is also forced-expanded and renders FR-021 stop detail when present", () => {
      const fallbackResponse: DropOffSearchResponse = {
        status: "fallback",
        candidates: [{ ...RANK1_WITH_STOPS, exceedsThreshold: true }],
        warning: "None of the drop-off points found keep your detour under 15 minutes.",
        requestId: "r1",
        timingMs: 900,
      };
      render(fallbackResponse);
      const t1 = toggle(1);
      expect(t1.getAttribute("role")).toBeNull();
      expect(t1.hasAttribute("aria-expanded")).toBe(false);
      const text = card(1).textContent!;
      expect(text).toContain("Walk to Oak Ave & Main St");
      expect(text).toContain("Board 506 → Downtown Loop");
      expect(text).toContain("Arrive at Bay St Station");
    });

    it("configurability sanity: a differently-labeled/valued boardingStop/arrivalStop on the SAME rank renders its own new values, not a hardcoded string", () => {
      const customResponse: DropOffSearchResponse = {
        status: "ranked",
        candidates: [
          {
            ...RANK1_WITH_STOPS,
            boardingStop: {
              name: "Totally Different Stop Name",
              location: { lat: 1, lng: 1 },
              lineName: "999",
              headsign: "Somewhere Else",
            },
            arrivalStop: {
              name: "A Different Arrival Stop",
              location: { lat: 2, lng: 2 },
              lineName: "999",
              headsign: "Somewhere Else",
            },
          },
        ],
        requestId: "r1",
        timingMs: 1,
      };
      render(customResponse);
      const text = card(1).textContent!;
      expect(text).toContain("Walk to Totally Different Stop Name");
      expect(text).toContain("Board 999 → Somewhere Else");
      expect(text).toContain("Arrive at A Different Arrival Stop");
      expect(text).not.toContain("Downtown Loop");
      expect(text).not.toContain("Bay St Station");
    });
  });
});
