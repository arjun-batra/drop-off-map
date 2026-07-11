import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/frontend/App";
import type { PublicConfig } from "../../src/config/schema";

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

function mockFetchConfig(config: PublicConfig) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => config,
    }),
  );
}

const freeTierConfig: PublicConfig = {
  appMode: "free_tier",
  geographicCenter: { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" },
  geographicRadiusKm: 200,
  maxCandidatesReturned: 3,
  transitModesIncluded: "all",
  minGeocodeQueryLength: 3,
  geocodeDebounceMs: 300,
  responseTimeTargetSeconds: 5,
  mapTileUrlTemplate: null,
  mapTileAttribution: null,
};

const paidTierConfig: PublicConfig = { ...freeTierConfig, appMode: "paid_tier" };

describe("App -- FR-016/FR-017 gate rendering", () => {
  it("free_tier: renders the Input Screen directly, never the password gate", async () => {
    mockFetchConfig(freeTierConfig);

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Find drop-off points");
    expect(container.textContent).not.toContain("requires a password");
  });

  it("paid_tier, fresh session (no sessionStorage flag): renders the password gate, not the Input Screen", async () => {
    mockFetchConfig(paidTierConfig);

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("requires a password");
    expect(container.textContent).not.toContain("Find drop-off points");
  });

  it("paid_tier with an existing client session flag: skips the gate, renders the Input Screen", async () => {
    sessionStorage.setItem("dropspot_authenticated", "true");
    mockFetchConfig(paidTierConfig);

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Find drop-off points");
  });

  it("network failure fetching /api/config/public: shows an error state, not a blank/crashed page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Something went wrong");
  });
});
