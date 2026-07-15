import { useRef, useState } from "react";
import type { PublicConfig } from "../../config/schema";
import type { DropOffSearchCandidate, DropOffSearchRequest, DropOffSearchResponse } from "../../search/types";
import { confirmTollReentry, searchDropOffPoints } from "../api";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { ErrorBoundary } from "./ErrorBoundary";
import { InputScreen } from "./InputScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultsScreen } from "./ResultsScreen";
import { SearchErrorScreen } from "./SearchErrorScreen";
import { TollRoadCheckScreen } from "./TollRoadCheckScreen";

interface SearchFlowProps {
  config: PublicConfig;
  /**
   * REV-002/INC-8 re-auth behavior: called when the search endpoint reports
   * `401 unauthorized` -- i.e. the paid_tier session cookie has expired or
   * was rotated out from under the user mid-session. The parent (App.tsx)
   * responds by dropping back to the Password Gate rather than showing a
   * generic "something went wrong" failure, since the real cause is
   * re-authentication, not a network/provider problem. Optional so
   * `free_tier` (where this can never legitimately happen) doesn't need to
   * wire anything up.
   */
  onSessionExpired?: () => void;
}

type LatLng = { lat: number; lng: number };

type Stage =
  | { kind: "input" }
  | { kind: "loading"; request: DropOffSearchRequest; variant: "search" | "confirm" }
  | {
      kind: "tollCheck";
      request: DropOffSearchRequest;
      response: DropOffSearchResponse;
      round: 1 | 2;
      /** Cumulative "No" answers across every round so far (ux-spec.md section 5a.4 -- the confirm call always carries the full cumulative set). */
      rejectedSoFar: LatLng[];
    }
  | {
      kind: "results";
      request: DropOffSearchRequest;
      response: DropOffSearchResponse;
      /** FR-019 (INC-14, ux-spec.md section 6.4a): candidate count excluded via the Toll Road Check flow, for the excluded-candidate notice. Undefined when this search never went through that flow (the common case). */
      excludedCandidateCount?: number;
    }
  | { kind: "error"; retry: () => void; onEditSearch: () => void };

/**
 * Defensive against a malformed `candidates` entry (e.g. `null`) reaching
 * this component before `ResultsScreen`'s own `ErrorBoundary` (REV-012) ever
 * gets a chance to catch it -- this function runs inside `runSearch`/
 * `runConfirm`, upstream of `ResultsScreen`'s rendering, so a crash here
 * would surface as an unhandled rejection instead of the intended
 * crash-fallback UI. A malformed entry is simply treated as "not flagged"
 * rather than thrown on.
 */
function flaggedCandidates(response: DropOffSearchResponse): DropOffSearchCandidate[] {
  return response.candidates.filter(
    (candidate): candidate is DropOffSearchCandidate =>
      !!candidate && candidate.needsTollReentryConfirmation === true,
  );
}

/**
 * Orchestrates ux-spec.md's Input -> Loading -> [Toll Road Check] -> Results
 * | Error flow (screens 1-3, 2a, and section 7's failure state) around the
 * real `POST /api/drop-off-search` / `POST /api/drop-off-search/confirm-toll-reentry`
 * endpoints (design.md section 5.2, INC-6/INC-14).
 *
 * `InputScreen` stays a controlled form that reports a validated
 * `DropOffSearchRequest` upward via `onSubmit` rather than performing the
 * fetch itself -- this lets "Try again" (ux-spec.md section 7) resubmit the
 * exact same request without re-deriving anything from form state, and lets
 * "Edit search" (sections 6.3/7/5a.2) reopen the Input Screen seeded with the
 * last-submitted values (in-memory only, per NFR-003 -- nothing here is
 * persisted across a reload or a new visit).
 *
 * INC-14 (FR-019, ux-spec.md section 5a): after a successful search, if any
 * final candidate carries `needsTollReentryConfirmation: true`, this flow
 * detours through `TollRoadCheckScreen` (round 1) instead of going straight
 * to Results. Answering that screen calls `confirm-toll-reentry`; if *that*
 * response still has newly-flagged candidates, one more round (round 2) is
 * shown (section 5a.4) -- after which, regardless of any remaining flags,
 * the flow always proceeds to Results (the two-round hard cap, section
 * 5a.4/5a.5). Any candidate still carrying `needsTollReentryConfirmation:
 * true` at that point is the round-cap residual case; `ResultsScreen`/its
 * candidate card renders that candidate's own disclosure (ux-spec.md section
 * 5a.4/6.4 item 7) rather than this component tracking that separately --
 * this invariant holds because this component never transitions to
 * `"results"` while any candidate is flagged AND fewer than 2 rounds have
 * been shown.
 *
 * INC-7/REV-012: the "results" branch renders `<DisclaimerBanner>` as a
 * sibling *outside* an `<ErrorBoundary>` that wraps `<ResultsScreen>`, so the
 * FR-014 disclaimer stays visible even if a bug/malformed response data
 * crashes ResultsScreen's own rendering. `<LoadingScreen>` is given
 * `config.responseTimeTargetSeconds` so its "Still working..." copy swap
 * (ux-spec.md section 5) is driven by the same tunable the backend's
 * orchestration deadline uses (api/drop-off-search.ts), not a second
 * independently-guessed threshold.
 */
export function SearchFlow({ config, onSessionExpired }: SearchFlowProps) {
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [lastRequest, setLastRequest] = useState<DropOffSearchRequest | null>(null);

  // Guards against a stale/superseded search's promise resolving after the
  // user has cancelled or started a newer search: only the request whose
  // token still matches `currentSearchToken` when it resolves is allowed to
  // update `stage`. Incrementing the token on both cancel and on starting a
  // new search covers the cancel-then-resolve case and the
  // resolve-out-of-order (older search resolves after a newer one) case with
  // the same mechanism (BUG-001). Also guards the confirm-toll-reentry call
  // (INC-14) the same way -- a stale confirm response must not clobber a
  // stage the user has since navigated away from.
  const currentSearchToken = useRef(0);

  // REV-014 (INC-8): the in-flight request's AbortController. Aborting it
  // (on cancel, or when a newer search supersedes it) actually stops the
  // underlying fetch/backend pipeline, rather than only having its eventual
  // result ignored by the token check above -- BUG-001's fix alone couldn't
  // do this, since it only ever gated whether a *resolved* response gets
  // applied to `stage`.
  const activeAbortController = useRef<AbortController | null>(null);

  function goToInput() {
    setStage({ kind: "input" });
  }

  async function runSearch(request: DropOffSearchRequest) {
    const token = ++currentSearchToken.current;
    activeAbortController.current?.abort();
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLastRequest(request);
    setStage({ kind: "loading", request, variant: "search" });

    const outcome = await searchDropOffPoints(request, controller.signal);

    if (token !== currentSearchToken.current) {
      return;
    }

    if (!outcome.ok || !outcome.response) {
      if (outcome.errorCode === "unauthorized" && onSessionExpired) {
        onSessionExpired();
        return;
      }
      setStage({ kind: "error", retry: () => runSearch(request), onEditSearch: goToInput });
      return;
    }

    const response = outcome.response;

    // FR-019 (INC-14, ux-spec.md section 5a.0): round 1 of the Toll Road
    // Check screen is shown only when at least one final candidate is
    // flagged -- the common case (no toll re-entry pattern anywhere) goes
    // straight to Results, unaffected.
    if (flaggedCandidates(response).length > 0) {
      setStage({ kind: "tollCheck", request, response, round: 1, rejectedSoFar: [] });
      return;
    }

    setStage({ kind: "results", request, response });
  }

  async function runConfirm(
    request: DropOffSearchRequest,
    rejectedSoFar: LatLng[],
    completedRound: 1 | 2,
  ) {
    const token = ++currentSearchToken.current;
    activeAbortController.current?.abort();
    const controller = new AbortController();
    activeAbortController.current = controller;

    setStage({ kind: "loading", request, variant: "confirm" });

    const outcome = await confirmTollReentry(
      { originalRequest: request, rejectedCandidateLocations: rejectedSoFar },
      controller.signal,
    );

    if (token !== currentSearchToken.current) {
      return;
    }

    if (!outcome.ok || !outcome.response) {
      if (outcome.errorCode === "unauthorized" && onSessionExpired) {
        onSessionExpired();
        return;
      }
      // ux-spec.md section 5a.5: "Try again" re-issues the identical confirm
      // request (same inputs, same answers already given) -- never a fresh
      // search, so the user never has to re-answer the toll questions
      // because of a transient network failure.
      setStage({
        kind: "error",
        retry: () => runConfirm(request, rejectedSoFar, completedRound),
        onEditSearch: goToInput,
      });
      return;
    }

    const response = outcome.response;

    // ux-spec.md section 5a.4: hard cap at 2 rounds. If round 1 just
    // completed and the confirm response has newly-flagged candidates, show
    // round 2; otherwise (round 2 just completed, or nothing newly flagged)
    // always proceed to Results -- any residual flagged candidate becomes
    // the round-cap disclosure case ResultsScreen renders.
    if (completedRound === 1 && flaggedCandidates(response).length > 0) {
      setStage({ kind: "tollCheck", request, response, round: 2, rejectedSoFar });
      return;
    }

    setStage({ kind: "results", request, response, excludedCandidateCount: rejectedSoFar.length });
  }

  function cancelSearch() {
    currentSearchToken.current += 1;
    activeAbortController.current?.abort();
    setStage({ kind: "input" });
  }

  if (stage.kind === "loading") {
    return (
      <LoadingScreen
        onCancel={cancelSearch}
        responseTimeTargetSeconds={config.responseTimeTargetSeconds}
        variant={stage.variant}
      />
    );
  }

  if (stage.kind === "tollCheck") {
    return (
      <TollRoadCheckScreen
        candidates={flaggedCandidates(stage.response)}
        round={stage.round}
        onEditSearch={goToInput}
        onContinue={(newlyRejected) => {
          const cumulativeRejected = [...stage.rejectedSoFar, ...newlyRejected];
          runConfirm(stage.request, cumulativeRejected, stage.round);
        }}
      />
    );
  }

  if (stage.kind === "results") {
    // FR-014/REV-012: the disclaimer is present exactly when the response
    // carries candidates (design.md section 5.2 -- "ranked"/"fallback").
    // Rendered as a sibling *outside* the ErrorBoundary wrapping
    // ResultsScreen (not inside it) so a render crash anywhere in
    // ResultsScreen's data-dependent rendering can never take the
    // disclaimer down with it -- see DisclaimerBanner.tsx/ErrorBoundary.tsx.
    const showDisclaimer = stage.response.status === "ranked" || stage.response.status === "fallback";
    return (
      <>
        {showDisclaimer && <DisclaimerBanner />}
        <ErrorBoundary fallback={<ResultsRenderFailed onEditSearch={goToInput} />}>
          <ResultsScreen
            response={stage.response}
            request={stage.request}
            onEditSearch={goToInput}
            onTryAgain={() => runSearch(stage.request)}
            mapConfig={config}
            excludedCandidateCount={stage.excludedCandidateCount}
          />
        </ErrorBoundary>
      </>
    );
  }

  if (stage.kind === "error") {
    return <SearchErrorScreen onTryAgain={stage.retry} onEditSearch={stage.onEditSearch} />;
  }

  return (
    <InputScreen
      config={config}
      initialValues={
        lastRequest
          ? {
              start: lastRequest.start,
              driverDestination: lastRequest.driverDestination,
              passengerDestination: lastRequest.passengerDestination,
              maxDetourMinutesText: String(lastRequest.maxDetourMinutes),
              avoidTolls: lastRequest.avoidTolls,
            }
          : undefined
      }
      onSubmit={runSearch}
      onSessionExpired={onSessionExpired}
    />
  );
}

interface ResultsRenderFailedProps {
  onEditSearch: () => void;
}

/**
 * ErrorBoundary's fallback for a render crash inside ResultsScreen. Kept
 * deliberately minimal/static (no response/candidate data touched here
 * either) -- its only job is to give the user a way out (back to the Input
 * screen) while the DisclaimerBanner sibling above it (see the "results"
 * branch above) is still visibly present and unaffected.
 */
function ResultsRenderFailed({ onEditSearch }: ResultsRenderFailedProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__container" style={{ textAlign: "center", paddingTop: "3rem" }}>
        <h2 className="type-h2">Something went wrong showing your results</h2>
        <p className="type-body">Please edit your search and try again.</p>
        <button type="button" className="type-body-strong" onClick={onEditSearch}>
          ← Edit search
        </button>
      </div>
    </div>
  );
}
