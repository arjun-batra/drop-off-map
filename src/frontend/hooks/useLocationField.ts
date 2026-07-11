import { useCallback, useEffect, useRef, useState } from "react";
import { geocodeQuery, reverseGeocode } from "../api";
import type { GeoResult } from "../../geocoding/types";
import { RadiusValidator } from "../../geo/radiusValidator";

export type LocationFieldStatus =
  | "empty"
  | "typing"
  | "resolved"
  | "geolocating"
  | "geolocation_unavailable"
  | "unresolvable"
  | "out_of_service_area"
  | "provider_error";

export interface ResolvedLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface UseLocationFieldOptions {
  /** FR-004/DQ-1: only start + driverDestination are radius-checked; passengerDestination is exempt. */
  applyRadiusCheck: boolean;
  geographicCenter: { lat: number; lng: number; label: string };
  geographicRadiusKm: number;
  /** design.md section 7.1 (REV-006/REV-007): sourced from GET /api/config/public, never a local literal. */
  minGeocodeQueryLength: number;
  geocodeDebounceMs: number;
}

export interface UseLocationFieldResult {
  typedValue: string;
  status: LocationFieldStatus;
  suggestions: GeoResult[];
  resolvedValue: ResolvedLocation | null;
  isCurrentLocation: boolean;
  onTypedValueChange: (value: string) => void;
  onSelectSuggestion: (result: GeoResult) => void;
  onUseCurrentLocation: () => void;
  onBlur: () => void;
}

/**
 * Encapsulates one location field's full lifecycle (typed-address autocomplete
 * + "use my current location" + FR-004 radius check) per ux-spec.md section
 * 4.1. Used three times by InputScreen (start, driver destination, passenger
 * destination) with `applyRadiusCheck` set per design.md's resolved DQ-1.
 */
export function useLocationField(options: UseLocationFieldOptions): UseLocationFieldResult {
  const [typedValue, setTypedValue] = useState("");
  const [status, setStatus] = useState<LocationFieldStatus>("empty");
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [resolvedValue, setResolvedValue] = useState<ResolvedLocation | null>(null);
  const [isCurrentLocation, setIsCurrentLocation] = useState(false);

  const requestSeq = useRef(0);

  const applyRadiusOutcome = useCallback(
    (result: GeoResult): LocationFieldStatus => {
      if (!options.applyRadiusCheck) return "resolved";
      const within = RadiusValidator.isWithinServiceArea(
        { lat: result.lat, lng: result.lng },
        { geographicCenter: options.geographicCenter, geographicRadiusKm: options.geographicRadiusKm },
      );
      return within ? "resolved" : "out_of_service_area";
    },
    [options.applyRadiusCheck, options.geographicCenter, options.geographicRadiusKm],
  );

  useEffect(() => {
    const trimmed = typedValue.trim();

    if (resolvedValue && resolvedValue.label === typedValue) {
      return;
    }

    if (resolvedValue) {
      setResolvedValue(null);
      setIsCurrentLocation(false);
    }

    if (trimmed.length < options.minGeocodeQueryLength) {
      setSuggestions([]);
      setStatus(trimmed.length === 0 ? "empty" : "typing");
      return;
    }

    setStatus("typing");
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      geocodeQuery(trimmed).then((result) => {
        if (requestSeq.current !== seq) return;

        if (!result.ok) {
          setSuggestions([]);
          setStatus("provider_error");
          return;
        }

        setSuggestions(result.results);
        setStatus(result.results.length === 0 ? "unresolvable" : "typing");
      });
    }, options.geocodeDebounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedValue, options.minGeocodeQueryLength, options.geocodeDebounceMs]);

  const onTypedValueChange = useCallback((value: string) => {
    setTypedValue(value);
  }, []);

  const onSelectSuggestion = useCallback(
    (result: GeoResult) => {
      requestSeq.current += 1;
      setTypedValue(result.label);
      setResolvedValue(result);
      setIsCurrentLocation(false);
      setSuggestions([]);
      setStatus(applyRadiusOutcome(result));
    },
    [applyRadiusOutcome],
  );

  const onUseCurrentLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("geolocation_unavailable");
      return;
    }

    requestSeq.current += 1;
    setStatus("geolocating");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        reverseGeocode(position.coords.latitude, position.coords.longitude).then((result) => {
          if (!result.ok || result.results.length === 0) {
            setStatus("geolocation_unavailable");
            return;
          }

          const resolved = result.results[0];
          if (!resolved) {
            setStatus("geolocation_unavailable");
            return;
          }
          setTypedValue(resolved.label);
          setResolvedValue(resolved);
          setIsCurrentLocation(true);
          setSuggestions([]);
          setStatus(applyRadiusOutcome(resolved));
        });
      },
      () => {
        setStatus("geolocation_unavailable");
      },
    );
  }, [applyRadiusOutcome]);

  const onBlur = useCallback(() => {
    setStatus((current) => {
      if (current !== "typing") return current;
      const trimmed = typedValue.trim();
      if (trimmed.length < options.minGeocodeQueryLength) return trimmed.length === 0 ? "empty" : current;
      // Suggestions are showing but nothing was selected yet -- leave as-is
      // rather than falsely flagging a match-in-progress as unresolvable.
      if (suggestions.length > 0) return current;
      return "unresolvable";
    });
  }, [typedValue, suggestions, options.minGeocodeQueryLength]);

  return {
    typedValue,
    status,
    suggestions,
    resolvedValue,
    isCurrentLocation,
    onTypedValueChange,
    onSelectSuggestion,
    onUseCurrentLocation,
    onBlur,
  };
}
