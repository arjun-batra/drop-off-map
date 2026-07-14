/**
 * QA-owned real-browser harness for BUG-002 re-verification
 * (tests/browser/iconSizing.playwright.test.ts). Mounts the ACTUAL,
 * unmodified `ResultsScreen` component (src/frontend/components/ResultsScreen.tsx)
 * -- which itself renders the ACTUAL, unmodified icon components from
 * icons.tsx -- with a realistic ranked candidate fixture, so the test can
 * measure real rendered icon pixel dimensions in a real browser, not jsdom.
 *
 * Imports the app's real `global.css` (which `@import`s `tokens.css`,
 * src/frontend/styles/global.css line 1), exactly the way `main.tsx` does in
 * production, so `--icon-size-sm/md/lg` resolve from the same source of
 * truth the real app uses -- nothing here is QA-authored CSS or a
 * reimplementation of the tokens.
 *
 * The map panel is deliberately left disabled (`googleMapsJsApiKey: null`)
 * -- an already-covered, real production code path (see
 * ResultsScreen.test.tsx's "gracefully omits the map when
 * GOOGLE_MAPS_JS_API_KEY isn't configured" case) that lets this harness
 * render fully offline, without a live Google Maps JS API key/network call,
 * while every icon-bearing part of the card (journey strip, section
 * headers, collapsed-card chevron) still renders exactly as it does in
 * production.
 */
import { createRoot } from "react-dom/client";
import { ResultsScreen } from "../../../src/frontend/components/ResultsScreen";
import type { DropOffSearchCandidate, DropOffSearchRequest, DropOffSearchResponse } from "../../../src/search/types";
import "../../../src/frontend/styles/global.css";

const REQUEST: DropOffSearchRequest = {
  start: { lat: 43.6532, lng: -79.3832, label: "123 Elm St" },
  driverDestination: { lat: 43.75, lng: -79.4, label: "456 Bay St" },
  passengerDestination: { lat: 43.78, lng: -79.42, label: "789 King St" },
  maxDetourMinutes: 15,
};

// Rank 1: forced-expanded (TOP PICK) -- exercises the journey-strip `lg`
// icons (WalkIcon/TransitIcon/FlagIcon) plus the expanded-only "For the
// driver"/"For your passenger" section `md` icons (CarIcon/WalkIcon). No
// ChevronIcon here (forced-expanded cards render no toggle affordance).
const RANK1: DropOffSearchCandidate = {
  rank: 1,
  location: { lat: 43.66, lng: -79.4 },
  label: "Oak Ave & Main St",
  routeOrderIndex: 3,
  driveTimeToDropoffMinutes: 8,
  detourMinutes: 3,
  walkTimeMinutes: 4,
  waitTimeMinutes: 5,
  transitTimeMinutes: 17,
  passengerTotalTimeMinutes: 26,
  driverTotalTimeMinutes: 27,
  exceedsThreshold: false,
  boardingStop: {
    name: "Oak Ave & Main St",
    location: { lat: 43.66, lng: -79.4 },
    lineName: "506",
    headsign: "Downtown Loop",
  },
  arrivalStop: {
    name: "Bay St Station",
    location: { lat: 43.7, lng: -79.38 },
    lineName: "506",
    headsign: "Downtown Loop",
  },
};

// Rank 2: collapsed by default -- exercises the collapsed-card `sm`
// ChevronIcon (the 20x-oversized case BUG-002 originally measured at 326px).
const RANK2: DropOffSearchCandidate = {
  rank: 2,
  location: { lat: 43.67, lng: -79.41 },
  label: "Elm St & 2nd Ave",
  routeOrderIndex: 5,
  driveTimeToDropoffMinutes: 9,
  detourMinutes: 4,
  walkTimeMinutes: 6,
  waitTimeMinutes: 6,
  transitTimeMinutes: 18,
  passengerTotalTimeMinutes: 30,
  driverTotalTimeMinutes: 29,
  exceedsThreshold: false,
  boardingStop: {
    name: "Elm St & 5th Ave",
    location: { lat: 43.67, lng: -79.41 },
    lineName: "12",
    headsign: "Airport Express",
  },
  arrivalStop: {
    name: "King St Loop",
    location: { lat: 43.72, lng: -79.39 },
    lineName: "12",
    headsign: "Airport Express",
  },
};

const RESPONSE: DropOffSearchResponse = {
  status: "ranked",
  candidates: [RANK1, RANK2],
  requestId: "icon-sizing-harness",
  timingMs: 1,
  // route intentionally omitted: showMap already requires a non-null
  // googleMapsJsApiKey too (see mapConfig below), so omitting it here is
  // belt-and-suspenders, not load-bearing.
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element (#root) not found in icon-sizing.html.");
}

createRoot(container).render(
  <ResultsScreen
    response={RESPONSE}
    request={REQUEST}
    onEditSearch={() => {}}
    onTryAgain={() => {}}
    mapConfig={{ googleMapsJsApiKey: null }}
  />,
);

// Signals to the Playwright test that React has committed the tree, so it
// doesn't have to guess/poll for readiness with an arbitrary timeout.
document.body.setAttribute("data-harness-rendered", "true");
