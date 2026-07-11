import type { DropOffSearchCandidate, DropOffSearchRequest, DropOffSearchResponse } from "../../search/types";
import "./ResultsScreen.css";

interface ResultsScreenProps {
  response: DropOffSearchResponse;
  request: DropOffSearchRequest;
  onEditSearch: () => void;
  /** Re-issues the identical search (design.md section 6.3/8's "timeout" status -- "message distinct from the above, inviting retry"). */
  onTryAgain: () => void;
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
export function ResultsScreen({ response, request, onEditSearch, onTryAgain }: ResultsScreenProps) {
  const isMessageOnly =
    response.status === "no_viable_option" ||
    response.status === "out_of_service_area" ||
    response.status === "invalid_input" ||
    response.status === "timeout";

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

        {response.status === "fallback" && response.warning && (
          <div className="results-screen__warning-banner type-body-strong">{response.warning}</div>
        )}

        {(response.status === "ranked" || response.status === "fallback") && (
          <div className="results-screen__cards">
            {response.candidates.map((candidate) => (
              <CandidateCard key={candidate.rank} candidate={candidate} isFallback={response.status === "fallback"} />
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
}

function CandidateCard({ candidate, isFallback }: CandidateCardProps) {
  const isBest = candidate.rank === 1 && !isFallback;

  return (
    <article
      className={`results-screen__card ${isBest ? "results-screen__card--best" : ""} ${
        isFallback ? "results-screen__card--fallback" : ""
      }`}
    >
      <div className="results-screen__card-header">
        <span
          className={`type-label results-screen__rank-badge ${
            isFallback ? "results-screen__rank-badge--fallback" : ""
          }`}
        >
          {isFallback ? "CLOSEST OPTION" : `#${candidate.rank}`}
        </span>
        {isBest && <span className="type-label results-screen__best-label">BEST OPTION</span>}
      </div>

      <h2 className="type-h2 results-screen__card-title">{candidate.label}</h2>

      <div className="results-screen__section">
        <p className="type-label results-screen__section-title">Driver</p>
        <Row label="Drive to drop-off" value={formatMinutes(candidate.driveTimeToDropoffMinutes)} />
        <Row label="Added detour" value={`+${formatMinutes(candidate.detourMinutes)}`} danger={candidate.exceedsThreshold} />
        <Row label="Your total trip" value={formatMinutes(candidate.driverTotalTimeMinutes)} />
      </div>

      <div className="results-screen__section">
        <p className="type-label results-screen__section-title">Passenger</p>
        <Row label="Walk to stop" value={formatMinutes(candidate.walkTimeMinutes)} />
        <Row label="Wait + transit" value={formatMinutes(candidate.waitTimeMinutes + candidate.transitTimeMinutes)} />
        <Row label="Total to destination" value={formatMinutes(candidate.passengerTotalTimeMinutes)} />
      </div>
    </article>
  );
}

interface RowProps {
  label: string;
  value: string;
  danger?: boolean;
}

function Row({ label, value, danger }: RowProps) {
  return (
    <div className="results-screen__row">
      <span className="type-body results-screen__row-label">{label}</span>
      <span className={`type-body-strong ${danger ? "results-screen__row-value--danger" : ""}`}>{value}</span>
    </div>
  );
}
