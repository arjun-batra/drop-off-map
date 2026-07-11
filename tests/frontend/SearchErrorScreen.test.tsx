import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchErrorScreen } from "../../src/frontend/components/SearchErrorScreen";

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

function render(onTryAgain = vi.fn(), onEditSearch = vi.fn()) {
  act(() => {
    root = createRoot(container);
    root.render(<SearchErrorScreen onTryAgain={onTryAgain} onEditSearch={onEditSearch} />);
  });
}

describe("SearchErrorScreen -- ux-spec.md section 7", () => {
  it("renders the generic failure copy and both action buttons", () => {
    render();
    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("We ran into a problem finding drop-off points.");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Try again")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Edit search"))).toBe(
      true,
    );
  });

  it("'Try again' invokes onTryAgain", () => {
    const onTryAgain = vi.fn();
    render(onTryAgain);
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("'Edit search' invokes onEditSearch", () => {
    const onEditSearch = vi.fn();
    render(vi.fn(), onEditSearch);
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Edit search"))!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onEditSearch).toHaveBeenCalledTimes(1);
  });

  it("shows offline-specific copy when navigator.onLine is false", () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render();
    expect(container.textContent).toContain("You appear to be offline");
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  });
});
