import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DisclaimerBanner } from "../../src/frontend/components/DisclaimerBanner";
import { DISCLAIMER_TEXT } from "../../src/search/types";

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

describe("DisclaimerBanner -- FR-014, ux-spec.md section 6.2", () => {
  it("renders the exact required copy, not softened or shortened", () => {
    act(() => {
      root = createRoot(container);
      root.render(<DisclaimerBanner />);
    });

    expect(container.textContent).toContain(DISCLAIMER_TEXT);
    expect(container.textContent).toContain(
      "This is an estimated drop-off point only. Before stopping, confirm it's safe and legal to pull over here.",
    );
  });

  it("has no dismiss control of any kind (non-dismissible per FR-014)", () => {
    act(() => {
      root = createRoot(container);
      root.render(<DisclaimerBanner />);
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });

  it("uses role=alert (assistive-technology visible, not decorative-only)", () => {
    act(() => {
      root = createRoot(container);
      root.render(<DisclaimerBanner />);
    });

    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
});
