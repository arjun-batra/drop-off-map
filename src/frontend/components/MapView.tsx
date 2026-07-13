import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef, useState } from "react";
import { MUTED_MAP_STYLE } from "./mapStyle";
import "./MapView.css";

export interface MapViewCandidate {
  rank: number;
  location: { lat: number; lng: number };
}

interface MapViewProps {
  route: Array<{ lat: number; lng: number }>;
  candidates: MapViewCandidate[];
  /** ux-spec.md section 6.7: fallback candidates get the warning-colored marker, not the rank-1/neutral treatment. */
  variant: "ranked" | "fallback";
  /**
   * FR-022 / design.md section 7.2: `GOOGLE_MAPS_JS_API_KEY`, a distinct,
   * intentionally browser-exposed credential from the server-side
   * `MAP_API_KEY`. Never used for anything but loading this widget.
   */
  apiKey: string;
  highlightedRank: number | null;
  onSelectCandidate: (rank: number) => void;
}

const MARKER_SIZE = 32;
const MARKER_RADIUS = 14;
const MARKER_CENTER = MARKER_SIZE / 2;

/**
 * Reads a color token from tokens.css (docs/ux-spec.md section 2) at
 * runtime, so this component's markers stay in lockstep with the same
 * palette every other component references by CSS variable -- an SVG data-
 * URI marker icon can't apply a CSS class the way the old Leaflet divIcon
 * did, so reading the computed custom property is the equivalent mechanism
 * for "reference tokens, not inline literals" here. The literal fallback is
 * only a defensive guard for an environment where tokens.css genuinely isn't
 * loaded (e.g. a test harness) -- it is never reached in the running app,
 * and is not a configurable/tunable value.
 */
function readColorToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function markerColors(variant: "ranked" | "fallback", rank: number): { fill: string; text: string } {
  if (variant === "fallback") {
    return {
      fill: readColorToken("--color-warning-border", "#f0b429"),
      text: readColorToken("--color-text-primary", "#1a1d21"),
    };
  }
  if (rank === 1) {
    return {
      fill: readColorToken("--color-brand-primary", "#1e6fd9"),
      text: readColorToken("--color-on-brand-primary", "#ffffff"),
    };
  }
  return {
    fill: readColorToken("--color-text-secondary", "#5b6470"),
    text: readColorToken("--color-on-brand-primary", "#ffffff"),
  };
}

/**
 * ux-spec.md section 6.7 (2026-07-12): "Custom-colored markers, not default
 * red Google pins" -- builds a small colored-circle SVG (rank number, or "!"
 * for the fallback state) as a data-URI `google.maps.Icon`. REV-019: this
 * introduces its own rank-1/rank-other/fallback marker color distinction --
 * it does NOT reuse an existing coding from the candidate cards. The cards
 * (see ResultsScreen.css's `.results-screen__rank-badge`) render every
 * non-fallback rank badge in the same color; only the fallback badge is
 * visually distinct there. On the map, `markerColors()` above additionally
 * distinguishes rank 1 (brand-primary) from every other rank (secondary
 * gray), a visual distinction the cards don't make. Also adds a
 * focus-ring-colored halo when this marker is the tap-highlighted one.
 */
function buildMarkerIcon(
  rank: number,
  variant: "ranked" | "fallback",
  highlighted: boolean,
  SizeCtor: typeof google.maps.Size,
  PointCtor: typeof google.maps.Point,
): google.maps.Icon {
  const { fill, text } = markerColors(variant, rank);
  const strokeColor = readColorToken("--color-bg-surface", "#ffffff");
  const label = variant === "fallback" ? "!" : `#${rank}`;
  const ring = highlighted
    ? `<circle cx="${MARKER_CENTER}" cy="${MARKER_CENTER}" r="${MARKER_RADIUS + 3}" fill="none" stroke="${readColorToken(
        "--color-focus-ring",
        "rgba(30, 111, 217, 0.4)",
      )}" stroke-width="3" />`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MARKER_SIZE}" height="${MARKER_SIZE}" viewBox="0 0 ${MARKER_SIZE} ${MARKER_SIZE}">` +
    ring +
    `<circle cx="${MARKER_CENTER}" cy="${MARKER_CENTER}" r="${MARKER_RADIUS}" fill="${fill}" stroke="${strokeColor}" stroke-width="2" />` +
    `<text x="${MARKER_CENTER}" y="${MARKER_CENTER}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${text}">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new SizeCtor(MARKER_SIZE, MARKER_SIZE),
    anchor: new PointCtor(MARKER_CENTER, MARKER_CENTER),
  };
}

/**
 * ux-spec.md section 6.7 -- the Results-screen map panel, INC-10 (FR-022):
 * renders via Google's Maps JavaScript API (Dynamic Maps), replacing INC-9's
 * Leaflet + non-Google-tile implementation. Same functional contract as
 * before (design.md section 10, INC-10): route polyline + one pin per
 * candidate, tap-to-highlight, display-only for v1, using data already
 * present on `DropOffSearchResponse` (INC-3's route polyline, INC-6's
 * ranked/fallback candidates) -- this component makes no Directions/Distance
 * Matrix/Geocoding call of its own, only the one Maps JavaScript API load.
 *
 * Loaded via `@googlemaps/js-api-loader`'s functional API
 * (`setOptions`/`importLibrary`), not a hand-rolled `<script>` tag: the
 * library de-dupes the actual script/library load across every mount of
 * this component (e.g. re-running a search remounts this component), so
 * multiple `MapView` instances over a session never race to inject the
 * script twice or double-fire `google.maps` initialization.
 *
 * ux-spec.md section 6.7's "Default Google UI chrome is hidden except zoom
 * control" and "muted map style" decisions are implemented via `MapOptions`
 * (`disableDefaultUI` + `zoomControl` + `styles`) below -- both are plain
 * parameters on the same API load already required for FR-022, not a second
 * provider call or added cost.
 *
 * The Maps JavaScript API load is asynchronous (unlike Leaflet, which is
 * bundled and synchronous), so a load failure is a Promise rejection, not a
 * thrown render/effect error -- an `ErrorBoundary` alone (as used by
 * ResultsScreen.tsx, matching the INC-9/REV-012 "fail silently, isolate the
 * blast radius" pattern) cannot catch that. This component therefore also
 * catches the load promise itself and renders nothing on failure, so
 * ux-spec.md section 6.7's "if the map script fails to load, fail silently
 * and simply omit the panel" requirement holds for this async path too, not
 * only for synchronous rendering errors (which the ErrorBoundary still
 * covers as a second, independent layer of the same resilience pattern).
 */
export function MapView({ route, candidates, variant, apiKey, highlightedRank, onSelectCandidate }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const iconCtorsRef = useRef<{ Size: typeof google.maps.Size; Point: typeof google.maps.Point } | null>(null);
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const onSelectCandidateRef = useRef(onSelectCandidate);
  onSelectCandidateRef.current = onSelectCandidate;

  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Captured once, synchronously, so the cleanup below reads a stable
    // reference rather than `.current` at cleanup time (both are the same
    // Map/array instance throughout this effect's lifetime -- neither ref
    // is ever reassigned, only mutated in place -- but capturing them
    // locally is the fix react-hooks/exhaustive-deps itself recommends for
    // reading a ref inside a cleanup closure).
    const markers = markersRef.current;
    const listeners = listenersRef.current;

    async function init() {
      try {
        setOptions({ key: apiKey, v: "weekly" });
        const [{ Map: GoogleMap, Polyline }, { Marker }, { LatLngBounds, Size, Point }] = await Promise.all([
          importLibrary("maps"),
          importLibrary("marker"),
          importLibrary("core"),
        ]);

        if (cancelled || !containerRef.current) return;
        iconCtorsRef.current = { Size, Point };

        const map = new GoogleMap(containerRef.current, {
          disableDefaultUI: true,
          zoomControl: true,
          styles: MUTED_MAP_STYLE,
        });
        mapRef.current = map;

        const bounds = new LatLngBounds();
        let hasBoundsPoint = false;

        if (route.length > 1) {
          polylineRef.current = new Polyline({
            path: route,
            strokeColor: readColorToken("--color-brand-primary", "#1e6fd9"),
            strokeWeight: 4,
            map,
          });
          for (const point of route) {
            bounds.extend(point);
            hasBoundsPoint = true;
          }
        }

        markers.clear();
        for (const candidate of candidates) {
          const marker = new Marker({
            position: candidate.location,
            map,
            icon: buildMarkerIcon(candidate.rank, variantRef.current, candidate.rank === highlightedRank, Size, Point),
          });
          listeners.push(marker.addListener("click", () => onSelectCandidateRef.current(candidate.rank)));
          markers.set(candidate.rank, marker);
          bounds.extend(candidate.location);
          hasBoundsPoint = true;
        }

        if (hasBoundsPoint) {
          map.fitBounds(bounds, 24);
        } else {
          map.setCenter({ lat: 0, lng: 0 });
          map.setZoom(2);
        }
      } catch (err) {
        console.error("[MapView] failed to load Google Maps JavaScript API:", err);
        if (!cancelled) setLoadFailed(true);
      }
    }

    init();

    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
      listeners.length = 0;
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      mapRef.current = null;
    };
    // Route/candidates/variant/apiKey only ever change together, on a
    // brand-new search result -- re-running the full init on any of them
    // changing is correct and matches ResultsScreen remounting this
    // component per search, same rationale as INC-9's original comment here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctors = iconCtorsRef.current;
    if (!ctors) return;
    for (const [rank, marker] of markersRef.current) {
      marker.setIcon(buildMarkerIcon(rank, variantRef.current, rank === highlightedRank, ctors.Size, ctors.Point));
    }
  }, [highlightedRank]);

  if (loadFailed) return null;

  return <div ref={containerRef} className="map-view" role="img" aria-label="Map of the driving route and candidate drop-off points" />;
}
