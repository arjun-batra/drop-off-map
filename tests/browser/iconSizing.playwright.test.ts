// @vitest-environment node
/**
 * BUG-002 real-browser regression test (icon sizing).
 *
 * Independent re-verification of dev's fix (docs/handoff.md "INC-12 bug fix
 * cycle 1"): all five icon components in src/frontend/components/icons.tsx
 * used to apply `var(--icon-size-*)` as the SVG's `width`/`height` HTML
 * *attributes*, which do not resolve CSS custom properties -- QA originally
 * measured 3x-20x oversized icons in a real browser (docs/test-report.md's
 * BUG-002 entry). Dev's fix applies the size via an inline `style` object
 * instead, which does resolve CSS custom properties.
 *
 * jsdom (this repo's default vitest environment, vite.config.ts) does not
 * implement CSS custom-property resolution or real layout at all, so a
 * jsdom-based test cannot distinguish the fixed version from the broken one
 * -- both would report the same (meaningless) jsdom layout. This test
 * therefore drives a real Chromium instance via Playwright against a real
 * Vite-served page (tests/browser/fixtures/icon-sizing.html /
 * icon-sizing-entry.tsx) that mounts the ACTUAL, unmodified `ResultsScreen`
 * production component -- not a reimplementation or a standalone SVG/CSS
 * snippet -- with a realistic ranked-candidate fixture, and reads back real
 * `getBoundingClientRect()` measurements, the same method QA used to
 * originally catch BUG-002.
 *
 * Requires a Chromium binary Playwright can launch. If none is installed,
 * set PLAYWRIGHT_BROWSERS_PATH to an existing install (this sandbox has one
 * at /opt/pw-browsers, matching the pinned `playwright` devDependency
 * version) or run `npx playwright install chromium` once beforehand.
 */
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  // A from-scratch Vite dev server (not the repo's own vite.config.ts /
  // scripts/viteApiMiddleware.ts, which wires up the /api/* backend this
  // harness has no need for) -- just enough to serve real TSX/CSS through
  // the same React transform the production app uses.
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: "error",
    plugins: [react()],
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : undefined;
  if (!port) {
    throw new Error("Vite harness server did not report a listening port.");
  }
  baseUrl = `http://127.0.0.1:${port}`;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // ux-spec.md mobile viewport, same as prior INC-6/8/9/10/12 walkthroughs
  await page.goto(`${baseUrl}/tests/browser/fixtures/icon-sizing.html`);
  await page.waitForSelector("body[data-harness-rendered='true']");
  await page.waitForSelector("#results-screen-card-1");
}, 30_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

/** Reads a live-rendered icon's actual box in real browser layout units. */
async function iconBox(selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Icon not found or not visible for selector: ${selector}`);
  return box;
}

describe("BUG-002 regression -- icon sizing resolves real --icon-size-* pixel values in a real browser (ux-spec.md section 2.6)", () => {
  it("token values themselves are unchanged (sanity: the fix must not depend on retuning the tokens)", async () => {
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        sm: style.getPropertyValue("--icon-size-sm").trim(),
        md: style.getPropertyValue("--icon-size-md").trim(),
        lg: style.getPropertyValue("--icon-size-lg").trim(),
      };
    });
    expect(tokens).toEqual({ sm: "16px", md: "20px", lg: "24px" });
  });

  it("rank 1 (expanded) journey-strip icons (WalkIcon/TransitIcon/FlagIcon, size lg) render at exactly 24x24px, not the 70-90px BUG-002 originally measured", async () => {
    const strip = "#results-screen-card-1 .results-screen__journey-strip svg";
    const boxes = await page.locator(strip).all();
    expect(boxes.length).toBeGreaterThanOrEqual(3); // walk, transit, flag

    for (const locator of boxes) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeCloseTo(24, 0);
      expect(box!.height).toBeCloseTo(24, 0);
    }
  });

  it("rank 1 (expanded) section-header icons (CarIcon 'For the driver', WalkIcon 'For your passenger', size md) render at exactly 20x20px, not the ~217-241px BUG-002 originally measured", async () => {
    const headers = await page.locator("#results-screen-card-1 .results-screen__section-title svg").all();
    expect(headers.length).toBe(2); // CarIcon + WalkIcon

    for (const locator of headers) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeCloseTo(20, 0);
      expect(box!.height).toBeCloseTo(20, 0);
    }
  });

  it("rank 2 (collapsed) chevron (size sm) renders at exactly 16x16px, not the ~326px (~20x, full card width) BUG-002 originally measured", async () => {
    const box = await iconBox("#results-screen-card-2 .results-screen__chevron");
    expect(box.width).toBeCloseTo(16, 0);
    expect(box.height).toBeCloseTo(16, 0);
  });

  it("rank 2 (collapsed) journey-strip icons are also correctly sized even while collapsed (size is independent of expand/collapse state)", async () => {
    const boxes = await page.locator("#results-screen-card-2 .results-screen__journey-strip svg").all();
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const locator of boxes) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeCloseTo(24, 0);
      expect(box!.height).toBeCloseTo(24, 0);
    }
  });

  it("size is genuinely driven by the --icon-size-* CSS variables, not a coincidental fixed pixel value baked into the component (configurability check: change the token, the rendered icon changes with it)", async () => {
    // Overrides the real :root token at runtime, in the real browser --
    // this is the CSS var actually being consumed, not a QA re-mock of it.
    const styleHandle = await page.addStyleTag({ content: ":root { --icon-size-lg: 40px; }" });
    const box = await iconBox("#results-screen-card-1 .results-screen__journey-strip svg");
    expect(box.width).toBeCloseTo(40, 0);
    expect(box.height).toBeCloseTo(40, 0);

    // Restore for any subsequent test in this file by removing the
    // injected <style> tag itself (not just an inline property -- addStyleTag
    // adds a stylesheet, so an inline-property removeProperty call alone
    // would not undo it), keeping this test order-independent.
    await styleHandle.evaluate((el) => (el as Element).remove());
    const restored = await iconBox("#results-screen-card-1 .results-screen__journey-strip svg");
    expect(restored.width).toBeCloseTo(24, 0);
  });

  it("negative control: the OLD broken pattern (var(--icon-size-md) as a raw SVG width/height attribute) is confirmed to reproduce oversized rendering in this same real browser/page -- proves this test would actually catch a BUG-002 regression, not just assert the fix's number by construction", async () => {
    const brokenWidth = await page.evaluate(() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "var(--icon-size-md)");
      svg.setAttribute("height", "var(--icon-size-md)");
      svg.setAttribute("viewBox", "0 0 24 24");
      document.body.appendChild(svg);
      const rect = svg.getBoundingClientRect();
      svg.remove();
      return rect.width;
    });
    // The attribute value is invalid, so the browser falls back to the
    // SVG's default intrinsic auto-sizing behavior -- reliably NOT 20px,
    // demonstrating this page/setup is capable of exhibiting BUG-002's
    // class of failure when the broken pattern is actually present.
    expect(brokenWidth).not.toBeCloseTo(20, 0);
  });
});
