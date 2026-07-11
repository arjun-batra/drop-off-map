import { useId, useState, type KeyboardEvent } from "react";
import type { PublicConfig } from "../../config/schema";
import type { GeoResult } from "../../geocoding/types";
import { useLocationField, type LocationFieldStatus } from "../hooks/useLocationField";
import "./InputScreen.css";

interface InputScreenProps {
  config: PublicConfig;
}

/**
 * Screen 1 -- Input Screen, docs/ux-spec.md section 4.
 *
 * INC-2 scope: the three location fields are now fully wired to
 * geocoding/autocomplete, "use my current location", and FR-004's radius
 * check (start + driverDestination only -- passengerDestination is exempt
 * per design.md's resolved DQ-1). The detour field and the CTA/search
 * pipeline itself remain out of scope until INC-3/INC-6, so the CTA stays
 * disabled with the same "coming in a later increment" caption from INC-1.
 */
export function InputScreen({ config }: InputScreenProps) {
  const [maxDetourMinutes, setMaxDetourMinutes] = useState("");

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
        />
        <LocationField
          label="Your destination"
          applyRadiusCheck
          config={config}
        />
        <LocationField
          label="Passenger's destination"
          applyRadiusCheck={false}
          config={config}
        />

        <div className="input-screen__field">
          <label className="type-label" htmlFor="max-detour-input">
            Max acceptable detour (minutes)
          </label>
          <input
            id="max-detour-input"
            className="type-body input-screen__input focus-ring"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 10"
            value={maxDetourMinutes}
            onChange={(event) => setMaxDetourMinutes(event.target.value)}
          />
        </div>

        <button type="button" className="type-body-strong input-screen__cta" disabled>
          Find drop-off points
        </button>
        <p className="type-caption input-screen__scaffold-note">
          Search isn&rsquo;t wired up yet — coming in a later increment.
        </p>
      </div>
    </div>
  );
}

interface LocationFieldProps {
  label: string;
  applyRadiusCheck: boolean;
  config: PublicConfig;
}

const STATUS_HELPER_TEXT: Partial<Record<LocationFieldStatus, string>> = {
  geolocating: "Finding your location…",
  geolocation_unavailable: "Location access wasn't available. Please type an address instead.",
  unresolvable: "We couldn't find that address. Try a more specific address or a nearby cross street.",
  provider_error: "We couldn't check that address right now. Please try again.",
};

const DANGER_STATUSES: LocationFieldStatus[] = ["unresolvable", "out_of_service_area", "provider_error"];

function LocationField({ label, applyRadiusCheck, config }: LocationFieldProps) {
  const field = useLocationField({
    applyRadiusCheck,
    geographicCenter: config.geographicCenter,
    geographicRadiusKm: config.geographicRadiusKm,
  });
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const inputId = useId();
  const listboxId = useId();

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
