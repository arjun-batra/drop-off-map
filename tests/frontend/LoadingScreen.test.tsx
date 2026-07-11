import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadingScreen } from "../../src/frontend/components/LoadingScreen";

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

describe("LoadingScreen -- ux-spec.md section 5", () => {
  it("renders the spinner and primary/secondary copy", () => {
    act(() => {
      root = createRoot(container);
      root.render(<LoadingScreen onCancel={() => {}} />);
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("Finding the best drop-off points along your route");
    expect(container.textContent).toContain("Checking live traffic and transit data.");
  });

  it("clicking Cancel invokes the onCancel callback", () => {
    const onCancel = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(<LoadingScreen onCancel={onCancel} />);
    });

    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    act(() => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
