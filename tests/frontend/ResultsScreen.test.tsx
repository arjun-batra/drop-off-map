import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "../../src/frontend/components/ResultsScreen";
import type { DropOffSearchRequest, DropOffSearchResponse } from "../../src/search/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
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

function render(response: DropOffSearchResponse, onEditSearch = vi.fn()) {
  act(() => {
    root = createRoot(container);
    root.render(<ResultsScreen response={response} request={REQUEST} onEditSearch={onEditSearch} />);
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

  it("FR-014 deferral: the persistent safety/legality disclaimer is NOT rendered on any status this increment (INC-7 scope)", () => {
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
});
