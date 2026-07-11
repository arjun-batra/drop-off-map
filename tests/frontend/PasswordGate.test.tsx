import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordGate } from "../../src/frontend/components/PasswordGate";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  sessionStorage.clear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

function render(onSuccess: () => void) {
  act(() => {
    root = createRoot(container);
    root.render(<PasswordGate onSuccess={onSuccess} />);
  });
}

function passwordInput(): HTMLInputElement {
  return container.querySelector("#password-gate-input") as HTMLInputElement;
}

function submitButton(): HTMLButtonElement {
  return container.querySelector("button[type=submit]") as HTMLButtonElement;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PasswordGate -- ux-spec.md section 3", () => {
  it("disables Continue while the field is empty", () => {
    render(() => {});
    expect(submitButton().disabled).toBe(true);
  });

  it("enables Continue once a non-empty value is entered", () => {
    render(() => {});
    act(() => {
      setValue(passwordInput(), "x");
    });
    expect(submitButton().disabled).toBe(false);
  });

  it("wrong password: shows the exact error copy, clears the field, keeps gate open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_password" }),
      }),
    );
    const onSuccess = vi.fn();
    render(onSuccess);

    act(() => {
      setValue(passwordInput(), "wrong-password");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Incorrect password. Please try again.");
    expect(passwordInput().value).toBe("");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("correct password: calls onSuccess and sets the sessionStorage convenience flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    const onSuccess = vi.fn();
    render(onSuccess);

    act(() => {
      setValue(passwordInput(), "correct-password");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("dropspot_authenticated")).toBe("true");
  });
});
