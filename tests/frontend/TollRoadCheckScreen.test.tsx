import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TollRoadCheckScreen } from "../../src/frontend/components/TollRoadCheckScreen";
import type { DropOffSearchCandidate } from "../../src/search/types";

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

function candidate(overrides: Partial<DropOffSearchCandidate> = {}): DropOffSearchCandidate {
  return {
    rank: 1,
    location: { lat: 43.66, lng: -79.39 },
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
    needsTollReentryConfirmation: true,
    tollReentryDescription: "Highway 407 — exits and re-enters it during this trip",
    ...overrides,
  };
}

function findButton(text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text))! as HTMLButtonElement;
}

describe("TollRoadCheckScreen -- ux-spec.md section 5a (FR-019, INC-14)", () => {
  it("round 1 renders the exact ux-spec.md section 5a.2 mockup copy", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen candidates={[candidate()]} round={1} onContinue={() => {}} onEditSearch={() => {}} />,
      );
    });

    expect(container.textContent).toContain("One quick question about toll roads");
    expect(container.textContent).toContain(
      "One or more of your route options use a toll highway, but get off it and back on again during the trip",
    );
    expect(container.textContent).toContain("Uses Highway 407 — exits and re-enters it during this trip");
  });

  it("round 2 renders the exact ux-spec.md section 5a.4 mockup copy, not the round-1 copy", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen candidates={[candidate()]} round={2} onContinue={() => {}} onEditSearch={() => {}} />,
      );
    });

    expect(container.textContent).toContain("One more thing");
    expect(container.textContent).toContain(
      "Removing your earlier choice(s) brought in a replacement option that also needs a quick check.",
    );
    expect(container.textContent).not.toContain("One quick question about toll roads");
  });

  it("falls back to generic copy when tollReentryDescription is absent", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen
          candidates={[candidate({ tollReentryDescription: undefined })]}
          round={1}
          onContinue={() => {}}
          onEditSearch={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("This route gets on and off a toll highway more than once during the trip.");
  });

  it("Continue is disabled until every card has an explicit answer", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen
          candidates={[candidate({ location: { lat: 43.66, lng: -79.39 } }), candidate({ location: { lat: 43.67, lng: -79.38 }, label: "Elm St & 5th Ave" })]}
          round={1}
          onContinue={() => {}}
          onEditSearch={() => {}}
        />,
      );
    });

    const continueButton = findButton("Continue");
    expect(continueButton.disabled).toBe(true);

    const yesButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.includes("Yes, that's fine"));
    act(() => {
      yesButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(continueButton.disabled).toBe(true); // only 1 of 2 cards answered

    act(() => {
      yesButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(continueButton.disabled).toBe(false);
  });

  it("clicking Continue reports exactly the locations answered 'No', not the 'Yes' ones, and not a partial/stale set", () => {
    const onContinue = vi.fn();
    const locA = { lat: 43.66, lng: -79.39 };
    const locB = { lat: 43.67, lng: -79.38 };
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen
          candidates={[candidate({ location: locA, label: "A" }), candidate({ location: locB, label: "B" })]}
          round={1}
          onContinue={onContinue}
          onEditSearch={() => {}}
        />,
      );
    });

    const cards = Array.from(container.querySelectorAll(".toll-road-check__card"));
    const cardA = cards.find((c) => c.textContent?.includes("A"))!;
    const cardB = cards.find((c) => c.textContent?.includes("B"))!;

    act(() => {
      (Array.from(cardA.querySelectorAll("button")).find((b) => b.textContent?.includes("No, don't include it")) as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    act(() => {
      (Array.from(cardB.querySelectorAll("button")).find((b) => b.textContent?.includes("Yes, that's fine")) as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    act(() => {
      findButton("Continue").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith([locA]);
  });

  it("an answer can be changed before Continue is tapped (the card is not locked in after the first tap)", () => {
    const onContinue = vi.fn();
    const loc = { lat: 43.66, lng: -79.39 };
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen candidates={[candidate({ location: loc })]} round={1} onContinue={onContinue} onEditSearch={() => {}} />,
      );
    });

    act(() => findButton("No, don't include it").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => findButton("Yes, that's fine").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => findButton("Continue").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onContinue).toHaveBeenCalledWith([]); // final answer was "Yes", so nothing rejected
  });

  it("'Edit search' invokes onEditSearch and never onContinue, even with cards unanswered", () => {
    const onContinue = vi.fn();
    const onEditSearch = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(<TollRoadCheckScreen candidates={[candidate()]} round={1} onContinue={onContinue} onEditSearch={onEditSearch} />);
    });

    act(() => findButton("Edit search").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onEditSearch).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("renders one card per candidate, each with its own label", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <TollRoadCheckScreen
          candidates={[candidate({ label: "Oak Ave & Main St" }), candidate({ location: { lat: 43.9, lng: -79.1 }, label: "Elm St & 5th Ave" })]}
          round={1}
          onContinue={() => {}}
          onEditSearch={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("Oak Ave & Main St");
    expect(container.textContent).toContain("Elm St & 5th Ave");
    expect(container.querySelectorAll(".toll-road-check__card")).toHaveLength(2);
  });
});
