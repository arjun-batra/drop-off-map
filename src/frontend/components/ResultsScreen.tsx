import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { PublicConfig } from "../../config/schema";
import type { DropOffSearchCandidate, DropOffSearchRequest, DropOffSearchResponse } from "../../search/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { CarIcon, ChevronIcon, FlagIcon, TransitIcon, WalkIcon } from "./icons";
import { MapView } from "./MapView";
import "./ResultsScreen.css";

interface ResultsScreenProps {
  response: DropOffSearchResponse;
  request: DropOffSearchRequest;
  onEditSearch: () => void;
  /** Re-issues the identical search (design.md section 6.3/8's "timeout" status -- "message distinct from the above, inviting retry"). */
  onTryAgain: () => void;
  /** INC-10: only the Google Maps JS API key the map panel needs, not the full PublicConfig. */
  mapConfig: Pick<PublicConfig, "googleMapsJsApiKey">;
}

function formatMinutes(value: number): string {
  return `${Math.round(value)} min`;
}

function emptyStateTitle(status: DropOffSearchResponse["status"]): string {
  if (status === "no_viable_option") return "No drop-off points found";
  if (status === "timeout") return "This is taking longer than expected";
  return "We couldn't run that search";
}

/**
 * Screen 3 -- Results Screen, docs/ux-spec.md section 6. Covers all six
 * `DropOffSearchResponse.status` values:
 * - "ranked" (section 6.4): up to `maxCandidatesReturned` cards, rank-1 gets
 *   the "BEST OPTION" treatment.
 * - "fallback" (section 6.5): single "CLOSEST OPTION" card + warning banner.
 * - "no_viable_option" (section 6.6): empty state with `response.message`.
 * - "timeout" (INC-7, design.md section 6.3/8): empty state with
 *   `response.message` plus a "Try again" action -- distinct from
 *   "no_viable_option" so the copy invites a retry rather than implying the
 *   trip has no viable drop-off point.
 * - "out_of_service_area" / "invalid_input": not explicitly given their own
 *   Results-screen mockup in ux-spec.md (they're normally caught client-side
 *   at the Input Screen, per FR-003/FR-004's INC-2 field-level validation)
 *   -- these only reach this screen as a defense-in-depth path if the
 *   backend's own re-validation (design.md section 5.2) disagrees with the
 *   client. Rendered with the same empty-state layout as "no_viable_option",
 *   using `response.message`, rather than crashing or showing nothing, per
 *   ux-spec.md section 0's "never fail silently" principle.
 *
 * The persistent FR-014 disclaimer banner (ux-spec.md section 6.2) is
 * intentionally NOT rendered inside this component -- see SearchFlow.tsx,
 * which renders `<DisclaimerBanner>` as a sibling *outside* the ErrorBoundary
 * wrapping this component, so a crash anywhere in here can never hide the
 * disclaimer (REV-012).
 */
export function ResultsScreen({ response, request, onEditSearch, onTryAgain, mapConfig }: ResultsScreenProps) {
  const isMessageOnly =
    response.status === "no_viable_option" ||
    response.status === "out_of_service_area" ||
    response.status === "invalid_input" ||
    response.status === "timeout";

  const [highlightedRank, setHighlightedRank] = useState<number | null>(null);

  // ux-spec.md section 6.7: the map panel is omitted gracefully (not shown
  // broken/empty) on every message-only status -- there is nothing to plot --
  // and also when the operator hasn't configured `GOOGLE_MAPS_JS_API_KEY` at
  // all (config/schema.ts's `googleMapsJsApiKey` is optional, `null` when
  // unset -- this is the "map view disabled" case, not an error).
  // `response.route` is also only present when candidates.length > 0 (see
  // search/types.ts), so checking both is belt-and-suspenders against a
  // malformed/partial response.
  const showMap =
    (response.status === "ranked" || response.status === "fallback") &&
    !!response.route &&
    !!mapConfig.googleMapsJsApiKey;

  function handleSelectCandidate(rank: number) {
    setHighlightedRank(rank);
    document.getElementById(`results-screen-card-${rank}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="app-shell">
      <div className="app-shell__container results-screen">
        <button type="button" className="type-body results-screen__edit" onClick={onEditSearch}>
          ← Edit search
        </button>

        <p className="type-body-small results-screen__trip-summary">
          Your trip: {request.start.label} → {request.driverDestination.label}
          <br />
          Passenger to: {request.passengerDestination.label}
        </p>

        {isMessageOnly && (
          <div className="results-screen__empty-state">
            <h2 className="type-h2">{emptyStateTitle(response.status)}</h2>
            <p className="type-body results-screen__empty-body">{response.message}</p>
            {response.status === "timeout" && (
              <button type="button" className="type-body-strong results-screen__try-again" onClick={onTryAgain}>
                Try again
              </button>
            )}
          </div>
        )}

        {showMap && response.route && mapConfig.googleMapsJsApiKey && (
          // ux-spec.md section 6.7's own "if the map script fails to load,
          // fail silently and simply omit the panel" requirement,
          // structurally enforced the same way REV-012 already enforces it
          // for the disclaimer -- an ErrorBoundary around only the map, with
          // a `null` fallback, so a Maps JavaScript API init failure can
          // never take the cards (or anything else on this screen) down
          // with it. (MapView.tsx additionally guards its own async script-
          // load promise, since an ErrorBoundary alone cannot catch a
          // rejected Promise -- see that file's doc comment.)
          <ErrorBoundary fallback={null}>
            <MapView
              route={response.route}
              candidates={response.candidates.map((candidate) => ({ rank: candidate.rank, location: candidate.location }))}
              variant={response.status === "fallback" ? "fallback" : "ranked"}
              apiKey={mapConfig.googleMapsJsApiKey}
              highlightedRank={highlightedRank}
              onSelectCandidate={handleSelectCandidate}
            />
          </ErrorBoundary>
        )}

        {response.status === "fallback" && response.warning && (
          <div className="results-screen__warning-banner type-body-strong">{response.warning}</div>
        )}

        {(response.status === "ranked" || response.status === "fallback") && (
          <div className="results-screen__cards">
            {response.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.rank}
                candidate={candidate}
                isFallback={response.status === "fallback"}
                highlighted={candidate.rank === highlightedRank}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CandidateCardProps {
  candidate: DropOffSearchCandidate;
  isFallback: boolean;
  /** INC-9: true right after the matching map pin was tapped -- ux-spec.md section 6.7's "brief flash" on the corresponding card. */
  highlighted?: boolean;
}

/**
 * The redesigned itinerary-style candidate card -- ux-spec.md section 6.4
 * (2026-07-12 redesign, FR-006/FR-010/FR-013/FR-021). Replaces the old flat
 * "DRIVER"/"PASSENGER" label-value row list with a headline metric, a
 * glanceable journey strip, and per-leg rows that name the actual boarding/
 * arrival transit stop and line/direction (FR-021), present on every card
 * -- not only rank 1 -- via this one shared component every rank renders.
 *
 * Expand/collapse (section 6.4): rank 1 (non-fallback) and the single
 * fallback card are always expanded (`forcedExpanded`); ranks 2/3 default
 * collapsed and toggle via tap/Enter/Space on the card's header region, a
 * standard accessible disclosure widget (`aria-expanded`, keyboard-operable,
 * per section 8's 2026-07-12 accessibility note).
 */
function CandidateCard({ candidate, isFallback, highlighted }: CandidateCardProps) {
  const isBest = candidate.rank === 1 && !isFallback;
  const forcedExpanded = isBest || isFallback;
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const expanded = forcedExpanded || manuallyExpanded;
  // FR-021's own text / DEC-3: a walking-only candidate has no transit line
  // at all, so boardingStop/arrivalStop are both undefined together --
  // checking either defensively covers a (should-never-happen) partial
  // response without rendering a half-populated line/direction row.
  const isWalkingOnly = !candidate.boardingStop || !candidate.arrivalStop;
  const waitPlusTransitMinutes = candidate.waitTimeMinutes + candidate.transitTimeMinutes;

  function toggleExpanded() {
    if (forcedExpanded) return;
    setManuallyExpanded((prev) => !prev);
  }

  function handleToggleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (forcedExpanded) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
    }
  }

  return (
    <article
      id={`results-screen-card-${candidate.rank}`}
      className={`results-screen__card ${isBest ? "results-screen__card--best" : ""} ${
        isFallback ? "results-screen__card--fallback" : ""
      } ${expanded ? "results-screen__card--expanded" : "results-screen__card--collapsed"} ${
        highlighted ? "results-screen__card--flash" : ""
      }`}
    >
      <div
        className="results-screen__card-toggle"
        role={forcedExpanded ? undefined : "button"}
        tabIndex={forcedExpanded ? undefined : 0}
        aria-expanded={forcedExpanded ? undefined : expanded}
        onClick={forcedExpanded ? undefined : toggleExpanded}
        onKeyDown={forcedExpanded ? undefined : handleToggleKeyDown}
      >
        <div className="results-screen__card-header">
          <span
            className={`type-label results-screen__rank-badge ${
              isFallback ? "results-screen__rank-badge--fallback" : ""
            }`}
          >
            {isFallback ? "CLOSEST OPTION" : `#${candidate.rank}`}
          </span>
          {isBest && <span className="type-label results-screen__best-label">TOP PICK</span>}
          {!forcedExpanded && (
            <ChevronIcon expanded={expanded} size="sm" className="results-screen__chevron" />
          )}
        </div>

        <h2 className="type-h2 results-screen__card-title">{candidate.label}</h2>

        <div className="results-screen__headline">
          <span
            className={expanded ? "type-metric results-screen__headline-value" : "type-body-strong"}
          >
            {formatMinutes(candidate.passengerTotalTimeMinutes)}
          </span>
          <span className="type-caption results-screen__headline-caption">
            {expanded ? "total for your passenger" : "total"}
          </span>
        </div>

        <div className="results-screen__journey-strip">
          <span className="results-screen__journey-step">
            <WalkIcon size="lg" />
            {expanded && <span className="type-body-small">{formatMinutes(candidate.walkTimeMinutes)}</span>}
          </span>
          {!isWalkingOnly && (
            <span className="results-screen__journey-step results-screen__journey-step--transit">
              <TransitIcon size="lg" />
              {expanded && <span className="type-body-small">{formatMinutes(waitPlusTransitMinutes)}</span>}
            </span>
          )}
          <span className="results-screen__journey-step">
            <FlagIcon size="lg" />
          </span>
        </div>
      </div>

      {expanded && (
        <>
          <div className="results-screen__section">
            <p className="type-h3 results-screen__section-title">
              <CarIcon size="md" /> For the driver
            </p>
            <Row label="Drive time" value={formatMinutes(candidate.driveTimeToDropoffMinutes)} />
            <Row
              label="Added detour"
              value={`+${formatMinutes(candidate.detourMinutes)}`}
              danger={candidate.exceedsThreshold}
            />
            <Row label="Driver's total trip" value={formatMinutes(candidate.driverTotalTimeMinutes)} />
          </div>

          <div className="results-screen__section">
            <p className="type-h3 results-screen__section-title">
              <WalkIcon size="md" /> For your passenger
            </p>
            {isWalkingOnly ? (
              <Row label="Walk to destination" value={formatMinutes(candidate.walkTimeMinutes)} />
            ) : (
              <>
                <Row
                  label={`Walk to ${candidate.boardingStop!.name}`}
                  value={formatMinutes(candidate.walkTimeMinutes)}
                />
                <div className="results-screen__transit-row">
                  <span className="results-screen__transit-pill">
                    Board {candidate.boardingStop!.lineName} → {candidate.boardingStop!.headsign}
                  </span>
                  <div className="results-screen__transit-row-detail">
                    <span className="type-caption results-screen__transit-caption">wait &amp; ride</span>
                    <span className="type-body-strong">{formatMinutes(waitPlusTransitMinutes)}</span>
                  </div>
                </div>
                <p className="type-body results-screen__waypoint">Arrive at {candidate.arrivalStop!.name}</p>
              </>
            )}
            <Row
              label="Total to destination"
              value={formatMinutes(candidate.passengerTotalTimeMinutes)}
              strong
            />
          </div>
        </>
      )}
    </article>
  );
}

interface RowProps {
  label: string;
  value: string;
  danger?: boolean;
  /** "Total to destination"/"Driver's total trip" summary rows -- type-body-strong label too, not just the value (ux-spec.md section 6.4 anatomy item 6). */
  strong?: boolean;
}

function Row({ label, value, danger, strong }: RowProps) {
  return (
    <div className="results-screen__row">
      <span className={`${strong ? "type-body-strong" : "type-body"} results-screen__row-label`}>{label}</span>
      <span className={`type-body-strong ${danger ? "results-screen__row-value--danger" : ""}`}>{value}</span>
    </div>
  );
}
