import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
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
  tileUrlTemplate: string;
  tileAttribution: string;
  highlightedRank: number | null;
  onSelectCandidate: (rank: number) => void;
}

function markerClass(rank: number, variant: "ranked" | "fallback"): string {
  if (variant === "fallback") return "map-view__marker--fallback";
  return rank === 1 ? "map-view__marker--rank-1" : "map-view__marker--rank-other";
}

function buildDivIcon(rank: number, variant: "ranked" | "fallback", highlighted: boolean): L.DivIcon {
  const highlightClass = highlighted ? "map-view__marker--highlighted" : "";
  return L.divIcon({
    className: "map-view__marker-wrap",
    html: `<div class="map-view__marker ${markerClass(rank, variant)} ${highlightClass}">${variant === "fallback" ? "!" : `#${rank}`}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

/**
 * ux-spec.md section 6.7 -- the optional Results-screen map panel. Renders
 * the driver's route polyline + one pin per candidate using data already
 * present on `DropOffSearchResponse` (INC-3's decoded route polyline, INC-6's
 * ranked/fallback candidate points) -- no provider call of any kind
 * originates from this component. Tiles come from `tileUrlTemplate`
 * (design.md section 3.1a/10: a free-tier, non-Google, non-raw-OSM-demo-
 * server tile provider -- see docs/handoff.md's INC-9 section for which one
 * and why), never Google's Maps JavaScript API.
 *
 * Display-only for v1 (ux-spec.md section 6.7): no pan/zoom-driven
 * re-querying, no draggable pins, no recenter control beyond Leaflet's own
 * default zoom buttons. Tapping a pin reports `onSelectCandidate(rank)` so
 * the parent (ResultsScreen) can scroll/flash the matching card; tapping a
 * card does not re-center the map, per spec.
 *
 * Rendered by ResultsScreen inside an ErrorBoundary (SearchFlow.tsx's
 * existing pattern) so a Leaflet init failure can only take down this panel,
 * never the disclaimer or the text-based cards below it -- ux-spec.md
 * section 6.7's "fail silently, omit the panel" requirement.
 */
export function MapView({
  route,
  candidates,
  variant,
  tileUrlTemplate,
  tileAttribution,
  highlightedRank,
  onSelectCandidate,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const onSelectCandidateRef = useRef(onSelectCandidate);
  onSelectCandidateRef.current = onSelectCandidate;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      attributionControl: true,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer(tileUrlTemplate, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);

    const routeLatLngs = route.map((point): L.LatLngTuple => [point.lat, point.lng]);
    const bounds: L.LatLngBoundsExpression = [];

    if (routeLatLngs.length > 1) {
      L.polyline(routeLatLngs, { className: "map-view__route", weight: 4 }).addTo(map);
      bounds.push(...routeLatLngs);
    }

    const markers = markersRef.current;
    markers.clear();
    for (const candidate of candidates) {
      const latLng: L.LatLngTuple = [candidate.location.lat, candidate.location.lng];
      const marker = L.marker(latLng, {
        icon: buildDivIcon(candidate.rank, variant, candidate.rank === highlightedRank),
      }).addTo(map);
      marker.on("click", () => onSelectCandidateRef.current(candidate.rank));
      markers.set(candidate.rank, marker);
      bounds.push(latLng);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [24, 24] });
    } else {
      map.setView([0, 0], 2);
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // Route/candidates/variant/tile settings only ever change together, on a
    // brand-new search result -- re-running the full init on any of them
    // changing is correct and matches ResultsScreen remounting this
    // component per search (see ResultsScreen.tsx's `key` usage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (const [rank, marker] of markersRef.current) {
      const wrapperElement = marker.getElement();
      const markerElement = wrapperElement?.querySelector(".map-view__marker");
      markerElement?.classList.toggle("map-view__marker--highlighted", rank === highlightedRank);
    }
  }, [highlightedRank]);

  return <div ref={containerRef} className="map-view" role="img" aria-label="Map of the driving route and candidate drop-off points" />;
}
