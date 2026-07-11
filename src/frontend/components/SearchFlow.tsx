import { useRef, useState } from "react";
import type { PublicConfig } from "../../config/schema";
import type { DropOffSearchRequest, DropOffSearchResponse } from "../../search/types";
import { searchDropOffPoints } from "../api";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { ErrorBoundary } from "./ErrorBoundary";
import { InputScreen } from "./InputScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultsScreen } from "./ResultsScreen";
import { SearchErrorScreen } from "./SearchErrorScreen";

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

type Stage =
  | { kind: "input" }
  | { kind: "loading"; request: DropOffSearchRequest }
  | { kind: "results"; request: DropOffSearchRequest; response: DropOffSearchResponse }
  | { kind: "error"; request: DropOffSearchRequest };

/**
 * Orchestrates ux-spec.md's Input -> Loading -> Results | Error flow
 * (screens 1-3 + section 7's failure state) around the real
 * `POST /api/drop-off-search` endpoint (design.md section 5.2, INC-6).
 *
 * `InputScreen` stays a controlled form that reports a validated
 * `DropOffSearchRequest` upward via `onSubmit` rather than performing the
 * fetch itself -- this lets "Try again" (ux-spec.md section 7) resubmit the
 * exact same request without re-deriving anything from form state, and lets
 * "Edit search" (sections 6.3/7) reopen the Input Screen seeded with the
 * last-submitted values (in-memory only, per NFR-003 -- nothing here is
 * persisted across a reload or a new visit).
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
  // the same mechanism (BUG-001).
  const currentSearchToken = useRef(0);

  // REV-014 (INC-8): the in-flight request's AbortController. Aborting it
  // (on cancel, or when a newer search supersedes it) actually stops the
  // underlying fetch/backend pipeline, rather than only having its eventual
  // result ignored by the token check above -- BUG-001's fix alone couldn't
  // do this, since it only ever gated whether a *resolved* response gets
  // applied to `stage`.
  const activeAbortController = useRef<AbortController | null>(null);

  async function runSearch(request: DropOffSearchRequest) {
    const token = ++currentSearchToken.current;
    activeAbortController.current?.abort();
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLastRequest(request);
    setStage({ kind: "loading", request });

    const outcome = await searchDropOffPoints(request, controller.signal);

    if (token !== currentSearchToken.current) {
      return;
    }

    if (!outcome.ok || !outcome.response) {
      if (outcome.errorCode === "unauthorized" && onSessionExpired) {
        onSessionExpired();
        return;
      }
      setStage({ kind: "error", request });
      return;
    }

    setStage({ kind: "results", request, response: outcome.response });
  }

  function cancelSearch() {
    currentSearchToken.current += 1;
    activeAbortController.current?.abort();
    setStage({ kind: "input" });
  }

  if (stage.kind === "loading") {
    return <LoadingScreen onCancel={cancelSearch} responseTimeTargetSeconds={config.responseTimeTargetSeconds} />;
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
        <ErrorBoundary fallback={<ResultsRenderFailed onEditSearch={() => setStage({ kind: "input" })} />}>
          <ResultsScreen
            response={stage.response}
            request={stage.request}
            onEditSearch={() => setStage({ kind: "input" })}
            onTryAgain={() => runSearch(stage.request)}
            mapConfig={config}
          />
        </ErrorBoundary>
      </>
    );
  }

  if (stage.kind === "error") {
    return (
      <SearchErrorScreen
        onTryAgain={() => runSearch(stage.request)}
        onEditSearch={() => setStage({ kind: "input" })}
      />
    );
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
