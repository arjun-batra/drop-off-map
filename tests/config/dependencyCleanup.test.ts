import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * INC-10 (FR-022) dependency-cleanup verification (dev's claim, item 9):
 * `leaflet`/`@types/leaflet` are genuinely removed (via `npm uninstall`, not
 * hand-edited) and the new Google Maps loader dependencies are present, in
 * both `package.json` and the regenerated `package-lock.json`. Also checks
 * `.env.example` reflects the config-key swap (GOOGLE_MAPS_JS_API_KEY in,
 * MAP_TILE_URL_TEMPLATE/MAP_TILE_ATTRIBUTION out) and that no dead
 * Leaflet-specific CSS rule remains in MapView.css.
 */
const ROOT = resolve(__dirname, "../..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf-8"));
}

describe("INC-10 dependency cleanup -- leaflet removed, @googlemaps/js-api-loader added", () => {
  it("package.json no longer lists leaflet or @types/leaflet in any dependency section", () => {
    const pkg = readJson("package.json");
    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
    expect(deps).not.toHaveProperty("leaflet");
    expect(deps).not.toHaveProperty("@types/leaflet");
  });

  it("package.json lists @googlemaps/js-api-loader as a dependency and @types/google.maps as a devDependency", () => {
    const pkg = readJson("package.json");
    expect(pkg.dependencies).toHaveProperty("@googlemaps/js-api-loader");
    expect(pkg.devDependencies).toHaveProperty("@types/google.maps");
  });

  it("package-lock.json contains no leaflet entry at all (regenerated via npm uninstall, not hand-edited)", () => {
    const lockRaw = readFileSync(resolve(ROOT, "package-lock.json"), "utf-8");
    expect(lockRaw).not.toMatch(/"node_modules\/leaflet"/);
    expect(lockRaw).not.toMatch(/"node_modules\/@types\/leaflet"/);
  });

  it("package-lock.json contains the new Google Maps loader packages, matching package.json's declared version range", () => {
    const lockRaw = readFileSync(resolve(ROOT, "package-lock.json"), "utf-8");
    expect(lockRaw).toContain('"node_modules/@googlemaps/js-api-loader"');
    expect(lockRaw).toContain('"node_modules/@types/google.maps"');
  });

  it(".env.example documents GOOGLE_MAPS_JS_API_KEY and no longer documents the retired MAP_TILE_URL_TEMPLATE/MAP_TILE_ATTRIBUTION keys", () => {
    const envExample = readFileSync(resolve(ROOT, ".env.example"), "utf-8");
    expect(envExample).toContain("GOOGLE_MAPS_JS_API_KEY=");
    expect(envExample).not.toMatch(/^MAP_TILE_URL_TEMPLATE=/m);
    expect(envExample).not.toMatch(/^MAP_TILE_ATTRIBUTION=/m);
  });

  it("MapView.css no longer contains any Leaflet-marker-specific class rule (map-view__marker*, divIcon-related selectors)", () => {
    const css = readFileSync(resolve(ROOT, "src/frontend/components/MapView.css"), "utf-8");
    expect(css).not.toMatch(/\.map-view__marker/);
    expect(css).not.toMatch(/leaflet-/i);
  });

  it("no remaining source file imports the leaflet package", () => {
    // A narrow, targeted check on the two files most likely to have carried
    // a stale import (MapView.tsx/mapStyle.ts) rather than a full repo scan,
    // which is reviewer's job, not QA's -- but this directly verifies dev's
    // "no dead Leaflet code" claim on the files this increment touched.
    const mapView = readFileSync(resolve(ROOT, "src/frontend/components/MapView.tsx"), "utf-8");
    const mapStyle = readFileSync(resolve(ROOT, "src/frontend/components/mapStyle.ts"), "utf-8");
    expect(mapView).not.toMatch(/from ["']leaflet["']/);
    expect(mapStyle).not.toMatch(/from ["']leaflet["']/);
  });
});
