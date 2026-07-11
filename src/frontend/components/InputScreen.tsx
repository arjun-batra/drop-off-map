import { useState } from "react";
import "./InputScreen.css";

/**
 * Screen 1 -- Input Screen shell, docs/ux-spec.md section 4.
 *
 * INC-1 scope only: fields are present and typeable but not wired to real
 * geocoding/autocomplete, "use my current location", or search -- that
 * lands in INC-2/INC-3 per docs/design.md section 10. The submit button is
 * intentionally disabled so this scaffold can't silently produce a
 * misleading result.
 */
export function InputScreen() {
  const [start, setStart] = useState("");
  const [driverDestination, setDriverDestination] = useState("");
  const [passengerDestination, setPassengerDestination] = useState("");
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
          value={start}
          onChange={setStart}
        />
        <LocationField
          label="Your destination"
          value={driverDestination}
          onChange={setDriverDestination}
        />
        <LocationField
          label="Passenger's destination"
          value={passengerDestination}
          onChange={setPassengerDestination}
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
          Address lookup and search aren&rsquo;t wired up yet — coming in a later increment.
        </p>
      </div>
    </div>
  );
}

interface LocationFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function LocationField({ label, value, onChange }: LocationFieldProps) {
  return (
    <div className="input-screen__field">
      <label className="type-label">{label}</label>
      <input
        className="type-body input-screen__input focus-ring"
        type="text"
        placeholder="Enter an address…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="type-body-small input-screen__geolocate" disabled>
        📍 Use my current location
      </button>
    </div>
  );
}
