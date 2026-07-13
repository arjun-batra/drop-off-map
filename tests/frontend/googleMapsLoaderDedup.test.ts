import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/**
 * INC-10 item 8 (spot-check of the "library de-dupes loading across mounts"
 * claim). This file deliberately does NOT mock `@googlemaps/js-api-loader`
 * -- it exercises the real, installed `@googlemaps/js-api-loader` v2.1.1
 * package directly (the exact functions `MapView.tsx` calls:
 * `setOptions`/`importLibrary`), to independently verify -- rather than
 * trust dev's/the package's own documentation -- that calling
 * `setOptions`/`importLibrary` multiple times (e.g. from two separate
 * `MapView` mounts across two searches in one session) injects the Google
 * Maps script tag into <head> only once.
 *
 * There is no real network/API key in this sandbox, so the injected
 * script's own `onload`/callback never fires here -- that's fine, this test
 * only needs to observe the synchronous/near-synchronous DOM side effect of
 * script injection, not a full successful load. `importLibrary()`'s
 * returned promises are deliberately left unresolved/unawaited (with a
 * `.catch(() => {})` no-op to avoid an unhandled-rejection warning) -- they
 * hang forever in this environment, which does not affect what this test
 * asserts.
 */
describe("@googlemaps/js-api-loader (real, unmocked) -- INC-10 item 8: script injection dedupes across multiple importLibrary() call sites", () => {
  beforeEach(() => {
    document.head.querySelectorAll("script").forEach((el) => el.remove());
  });

  afterEach(() => {
    document.head.querySelectorAll("script").forEach((el) => el.remove());
  });

  it("injects exactly one <script> tag even when setOptions/importLibrary are called repeatedly, as if from multiple MapView mounts", async () => {
    setOptions({ key: "test-key-mount-1", v: "weekly" });
    void importLibrary("maps").catch(() => {});
    void importLibrary("marker").catch(() => {});
    void importLibrary("core").catch(() => {});

    // A second "mount" (e.g. a second search in the same session) redoing
    // the exact same setOptions/importLibrary sequence MapView.tsx's init()
    // effect performs on every mount.
    setOptions({ key: "test-key-mount-1", v: "weekly" });
    void importLibrary("maps").catch(() => {});
    void importLibrary("marker").catch(() => {});
    void importLibrary("core").catch(() => {});

    await vi.waitFor(
      () => {
        const scripts = document.head.querySelectorAll("script[src*='maps.googleapis.com']");
        expect(scripts.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    const scripts = document.head.querySelectorAll("script[src*='maps.googleapis.com']");
    expect(scripts.length).toBe(1);
  });
});
