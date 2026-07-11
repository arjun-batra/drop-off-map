import { useState } from "react";
import type { PublicConfig } from "../../config/schema";
import type { DropOffSearchRequest, DropOffSearchResponse } from "../../search/types";
import { searchDropOffPoints } from "../api";
import { InputScreen } from "./InputScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultsScreen } from "./ResultsScreen";
import { SearchErrorScreen } from "./SearchErrorScreen";

interface SearchFlowProps {
  config: PublicConfig;
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
 */
export function SearchFlow({ config }: SearchFlowProps) {
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [lastRequest, setLastRequest] = useState<DropOffSearchRequest | null>(null);

  async function runSearch(request: DropOffSearchRequest) {
    setLastRequest(request);
    setStage({ kind: "loading", request });

    const outcome = await searchDropOffPoints(request);

    if (!outcome.ok || !outcome.response) {
      setStage({ kind: "error", request });
      return;
    }

    setStage({ kind: "results", request, response: outcome.response });
  }

  if (stage.kind === "loading") {
    return <LoadingScreen onCancel={() => setStage({ kind: "input" })} />;
  }

  if (stage.kind === "results") {
    return (
      <ResultsScreen
        response={stage.response}
        request={stage.request}
        onEditSearch={() => setStage({ kind: "input" })}
      />
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
    />
  );
}
