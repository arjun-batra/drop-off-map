import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { PublicConfig } from "../../config/schema";
import type { GeoResult } from "../../geocoding/types";
import type { DropOffSearchLocation, DropOffSearchRequest } from "../../search/types";
import { useLocationField, type LocationFieldStatus, type ResolvedLocation } from "../hooks/useLocationField";
import { validateMaxDetourMinutes } from "../validation/detourMinutes";
import "./InputScreen.css";

export interface InputScreenInitialValues {
  start: DropOffSearchLocation | null;
  driverDestination: DropOffSearchLocation | null;
  passengerDestination: DropOffSearchLocation | null;
  maxDetourMinutesText: string;
}

interface InputScreenProps {
  config: PublicConfig;
  /** Seeds the form from the last-submitted request (ux-spec.md "Edit search"). */
  initialValues?: InputScreenInitialValues;
  onSubmit: (request: DropOffSearchRequest) => void;
}

/**
 * Screen 1 -- Input Screen, docs/ux-spec.md section 4.
 *
 * The three location fields are wired to geocoding/autocomplete, "use my
 * current location", and FR-004's radius check (start + driverDestination
 * only -- passengerDestination is exempt per design.md's resolved DQ-1), per
 * INC-2. The max-detour field (FR-002) validates numeric/positive input with
 * **no upper bound** (design.md section 1.3's explicit user decision -- see
 * ../validation/detourMinutes.ts), per INC-3. Per INC-6, the CTA now submits
 * a real `DropOffSearchRequest` once all four fields are valid -- SearchFlow.tsx
 * owns the actual fetch/stage transition, so this component stays a
 * controlled form that only reports a validated request upward.
 */
export function InputScreen({ config, initialValues, onSubmit }: InputScreenProps) {
  const [maxDetourMinutes, setMaxDetourMinutes] = useState(initialValues?.maxDetourMinutesText ?? "");
  const [detourTouched, setDetourTouched] = useState(false);
  const [start, setStart] = useState<ResolvedLocation | null>(initialValues?.start ?? null);
  const [driverDestination, setDriverDestination] = useState<ResolvedLocation | null>(
    initialValues?.driverDestination ?? null,
  );
  const [passengerDestination, setPassengerDestination] = useState<ResolvedLocation | null>(
    initialValues?.passengerDestination ?? null,
  );

  const detourValidation = validateMaxDetourMinutes(maxDetourMinutes);
  const detourError = detourTouched && !detourValidation.valid ? detourValidation.error : undefined;

  const canSubmit =
    start !== null && driverDestination !== null && passengerDestination !== null && detourValidation.valid;

  function handleSubmit() {
    setDetourTouched(true);
    if (!start || !driverDestination || !passengerDestination || !detourValidation.valid) return;

    onSubmit({
      start,
      driverDestination,
      passengerDestination,
      maxDetourMinutes: detourValidation.minutes,
    });
  }

  return (
    <div className="app-shell">
      <div className="app-shell__container input-screen">
        <header>
          <h1 className="type-h1">DropSpot</h1>
          <p className="type-body-small input-screen__tagline">
            Find the best spot along your route to drop someone off for transit.
          </p>
        </header>

        <LocationField
          label="Your start point"
          applyRadiusCheck
          config={config}
          initialValue={initialValues?.start ?? null}
          onResolvedChange={setStart}
        />
        <LocationField
          label="Your destination"
          applyRadiusCheck
          config={config}
          initialValue={initialValues?.driverDestination ?? null}
          onResolvedChange={setDriverDestination}
        />
        <LocationField
          label="Passenger's destination"
          applyRadiusCheck={false}
          config={config}
          initialValue={initialValues?.passengerDestination ?? null}
          onResolvedChange={setPassengerDestination}
        />

        <div className="input-screen__field">
          <label className="type-label" htmlFor="max-detour-input">
            Max acceptable detour (minutes)
          </label>
          <div
            className={`input-screen__input-wrap ${detourError ? "input-screen__input-wrap--error" : ""}`}
          >
            <input
              id="max-detour-input"
              className="type-body input-screen__input focus-ring"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 10"
              // FR-002 / design.md section 1.3: numeric, positive, no upper
              // bound -- deliberately no `max` attribute here.
              min={0}
              step="any"
              value={maxDetourMinutes}
              onChange={(event) => setMaxDetourMinutes(event.target.value)}
              onBlur={() => setDetourTouched(true)}
            />
          </div>
          {detourError && (
            <p className="type-body-small input-screen__helper input-screen__helper--danger">{detourError}</p>
          )}
        </div>

        <button
          type="button"
          className="type-body-strong input-screen__cta"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Find drop-off points
        </button>
      </div>
    </div>
  );
}

interface LocationFieldProps {
  label: string;
  applyRadiusCheck: boolean;
  config: PublicConfig;
  initialValue?: ResolvedLocation | null;
  onResolvedChange: (value: ResolvedLocation | null) => void;
}

const STATUS_HELPER_TEXT: Partial<Record<LocationFieldStatus, string>> = {
  geolocating: "Finding your location…",
  geolocation_unavailable: "Location access wasn't available. Please type an address instead.",
  unresolvable: "We couldn't find that address. Try a more specific address or a nearby cross street.",
  provider_error: "We couldn't check that address right now. Please try again.",
};

const DANGER_STATUSES: LocationFieldStatus[] = ["unresolvable", "out_of_service_area", "provider_error"];

function LocationField({ label, applyRadiusCheck, config, initialValue, onResolvedChange }: LocationFieldProps) {
  const field = useLocationField({
    applyRadiusCheck,
    geographicCenter: config.geographicCenter,
    geographicRadiusKm: config.geographicRadiusKm,
    minGeocodeQueryLength: config.minGeocodeQueryLength,
    geocodeDebounceMs: config.geocodeDebounceMs,
    initialValue: initialValue ?? null,
  });
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const inputId = useId();
  const listboxId = useId();

  // Lifts "is this field validly resolved" up to InputScreen so the CTA's
  // enabled state and the final submitted request can be derived from a
  // single source of truth, rather than InputScreen re-deriving it from
  // three independent hook instances it doesn't otherwise have access to.
  useEffect(() => {
    onResolvedChange(field.status === "resolved" ? field.resolvedValue : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.status, field.resolvedValue]);

  const showSuggestions = field.status === "typing" && field.suggestions.length > 0;
  const isDanger = DANGER_STATUSES.includes(field.status);
  const helperText =
    field.status === "out_of_service_area"
      ? `This location is outside our service area (within ${config.geographicRadiusKm} km of ${config.geographicCenter.label}). We don't support this area yet.`
      : STATUS_HELPER_TEXT[field.status];

  function selectSuggestion(result: GeoResult) {
    field.onSelectSuggestion(result);
    setActiveSuggestionIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => Math.min(prev + 1, field.suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      const chosen = field.suggestions[activeSuggestionIndex];
      if (chosen) selectSuggestion(chosen);
    } else if (event.key === "Escape") {
      setActiveSuggestionIndex(-1);
    }
  }

  return (
    <div className="input-screen__field">
      <label className="type-label" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={`input-screen__input-wrap ${isDanger ? "input-screen__input-wrap--error" : ""}`}
      >
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className="type-body input-screen__input focus-ring"
          type="text"
          placeholder="Enter an address…"
          value={field.typedValue}
          onChange={(event) => field.onTypedValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Defer so a click on a suggestion still registers before the list unmounts.
            window.setTimeout(field.onBlur, 150);
          }}
        />
        {field.status === "resolved" && (
          <span className="input-screen__status-icon" aria-hidden="true">
            ✓
          </span>
        )}
        {field.status === "geolocating" && (
          <span className="input-screen__status-icon input-screen__status-icon--spinner" aria-hidden="true" />
        )}
      </div>

      {field.isCurrentLocation && field.status !== "geolocating" && (
        <span className="input-screen__badge type-caption">📍 Current location</span>
      )}

      {showSuggestions && (
        <ul id={listboxId} role="listbox" className="input-screen__suggestions">
          {field.suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placeId ?? `${suggestion.lat},${suggestion.lng}`}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              className={`type-body-small input-screen__suggestion ${
                index === activeSuggestionIndex ? "input-screen__suggestion--active" : ""
              }`}
              // Mousedown (not click) fires before the input's blur handler.
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
            >
              {suggestion.label}
            </li>
          ))}
        </ul>
      )}

      {helperText && (
        <p
          className={`type-body-small input-screen__helper ${
            isDanger ? "input-screen__helper--danger" : "input-screen__helper--muted"
          }`}
        >
          {helperText}
        </p>
      )}

      <button
        type="button"
        className="type-body-small input-screen__geolocate"
        onClick={field.onUseCurrentLocation}
      >
        📍 Use my current location
      </button>
    </div>
  );
}
