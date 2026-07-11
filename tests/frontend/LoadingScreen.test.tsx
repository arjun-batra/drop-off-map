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
  vi.useRealTimers();
});

describe("LoadingScreen -- ux-spec.md section 5", () => {
  it("renders the spinner and primary/secondary copy", () => {
    act(() => {
      root = createRoot(container);
      root.render(<LoadingScreen onCancel={() => {}} responseTimeTargetSeconds={5} />);
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("Finding the best drop-off points along your route");
    expect(container.textContent).toContain("Checking live traffic and transit data.");
  });

  it("clicking Cancel invokes the onCancel callback", () => {
    const onCancel = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(<LoadingScreen onCancel={onCancel} responseTimeTargetSeconds={5} />);
    });

    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    act(() => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe("NFR-004 / design.md section 6.3 (INC-7) -- 'still working' copy swap", () => {
    it("swaps to 'Still working...' copy once responseTimeTargetSeconds elapses", () => {
      vi.useFakeTimers();
      act(() => {
        root = createRoot(container);
        root.render(<LoadingScreen onCancel={() => {}} responseTimeTargetSeconds={5} />);
      });

      expect(container.textContent).toContain("Checking live traffic and transit data.");

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(container.textContent).toContain("Still working");
      expect(container.textContent).not.toContain("Checking live traffic and transit data.");
    });

    it("configurability: a different responseTimeTargetSeconds changes when the copy swaps (not a hardcoded threshold)", () => {
      vi.useFakeTimers();
      act(() => {
        root = createRoot(container);
        root.render(<LoadingScreen onCancel={() => {}} responseTimeTargetSeconds={1} />);
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(container.textContent).toContain("Still working");
    });

    it("does not swap before responseTimeTargetSeconds has elapsed", () => {
      vi.useFakeTimers();
      act(() => {
        root = createRoot(container);
        root.render(<LoadingScreen onCancel={() => {}} responseTimeTargetSeconds={5} />);
      });

      act(() => {
        vi.advanceTimersByTime(4999);
      });

      expect(container.textContent).toContain("Checking live traffic and transit data.");
      expect(container.textContent).not.toContain("Still working");
    });
  });
});
