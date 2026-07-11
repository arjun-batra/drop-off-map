import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/frontend/components/ErrorBoundary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function ThrowingChild(): never {
  throw new Error("boom -- simulated malformed-data render crash");
}

function OkChild() {
  return <div data-testid="ok-child">fine</div>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("ErrorBoundary -- generic render-error isolation (INC-7, REV-012 dependency)", () => {
  it("happy path: renders children normally when nothing throws", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <ErrorBoundary fallback={<div>fallback</div>}>
          <OkChild />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="ok-child"]')).toBeTruthy();
    expect(container.textContent).not.toContain("fallback");
  });

  it("edge case: a child that throws during render is caught, and the fallback is shown instead of crashing the whole tree", () => {
    // React logs the caught error to console.error by default; suppress the
    // expected noise for a clean test run without hiding a genuine failure.
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      root = createRoot(container);
      root.render(
        <ErrorBoundary fallback={<div data-testid="fallback">Something went wrong</div>}>
          <ThrowingChild />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="fallback"]')).toBeTruthy();
    expect(container.textContent).toContain("Something went wrong");
  });
});
