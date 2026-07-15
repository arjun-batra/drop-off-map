import { useState } from "react";
import type { DropOffSearchCandidate } from "../../search/types";
import "./TollRoadCheckScreen.css";

export interface TollRoadCheckScreenProps {
  /** Only the candidates flagged `needsTollReentryConfirmation: true` on the current round's response (ux-spec.md section 5a.2/5a.4). */
  candidates: DropOffSearchCandidate[];
  /** 1 = first round (ux-spec.md section 5a.2), 2 = the one allowed follow-up round (section 5a.4). Purely a copy switch -- the backend has no concept of round number (design.md section 4.6/5.2). */
  round: 1 | 2;
  /** Called with exactly the candidate locations answered "No" (an empty array is valid -- ux-spec.md section 5a.3). */
  onContinue: (rejectedLocations: Array<{ lat: number; lng: number }>) => void;
  /** Identical affordance/behavior to the Results screen's (ux-spec.md section 6.3) -- returns to Input, values preserved, no confirm request sent. */
  onEditSearch: () => void;
}

function keyFor(candidate: DropOffSearchCandidate): string {
  return `${candidate.location.lat},${candidate.location.lng}`;
}

/**
 * Screen 2a -- Toll Road Check, docs/ux-spec.md section 5a (FR-019, INC-14).
 * A conditional interstitial between Loading and Results, shown only when at
 * least one final candidate carries `needsTollReentryConfirmation: true`.
 * Presents all currently-flagged candidates together (batched, section
 * 5a.1), each requiring an explicit "Yes, that's fine" / "No, don't include
 * it" answer before "Continue" is enabled (section 5a.2's disabled-CTA
 * pattern, mirroring the Input Screen's own validation-before-submit
 * approach, section 4.3).
 */
export function TollRoadCheckScreen({ candidates, round, onContinue, onEditSearch }: TollRoadCheckScreenProps) {
  const [answers, setAnswers] = useState<Record<string, "yes" | "no">>({});

  const allAnswered = candidates.every((candidate) => answers[keyFor(candidate)] !== undefined);

  function selectAnswer(candidate: DropOffSearchCandidate, answer: "yes" | "no") {
    setAnswers((prev) => ({ ...prev, [keyFor(candidate)]: answer }));
  }

  function handleContinue() {
    if (!allAnswered) return;
    const rejected = candidates
      .filter((candidate) => answers[keyFor(candidate)] === "no")
      .map((candidate) => candidate.location);
    onContinue(rejected);
  }

  return (
    <div className="app-shell">
      <div className="app-shell__container toll-road-check">
        <button type="button" className="type-body toll-road-check__edit" onClick={onEditSearch}>
          ← Edit search
        </button>

        {round === 1 ? (
          <>
            <h2 className="type-h2">One quick question about toll roads</h2>
            <p className="type-body toll-road-check__intro">
              One or more of your route options use a toll highway, but get off it and back on again during the
              trip — meaning you'd pay the toll twice instead of once. Let us know if that's okay for each option
              below.
            </p>
          </>
        ) : (
          <>
            <h2 className="type-h2">One more thing</h2>
            <p className="type-body toll-road-check__intro">
              Removing your earlier choice(s) brought in a replacement option that also needs a quick check.
            </p>
          </>
        )}

        <div className="toll-road-check__cards">
          {candidates.map((candidate) => {
            const key = keyFor(candidate);
            const answer = answers[key];
            return (
              <div key={key} className="toll-road-check__card">
                <h3 className="type-h2 toll-road-check__card-title">{candidate.label}</h3>
                <p className="type-body-small toll-road-check__card-description">
                  {candidate.tollReentryDescription
                    ? `Uses ${candidate.tollReentryDescription}`
                    : "This route gets on and off a toll highway more than once during the trip."}
                </p>
                <div className="toll-road-check__answers">
                  <button
                    type="button"
                    className={`type-body-strong toll-road-check__answer toll-road-check__answer--yes ${
                      answer === "yes" ? "toll-road-check__answer--selected-yes" : ""
                    }`}
                    aria-pressed={answer === "yes"}
                    onClick={() => selectAnswer(candidate, "yes")}
                  >
                    ✓ Yes, that's fine
                  </button>
                  <button
                    type="button"
                    className={`type-body-strong toll-road-check__answer toll-road-check__answer--no ${
                      answer === "no" ? "toll-road-check__answer--selected-no" : ""
                    }`}
                    aria-pressed={answer === "no"}
                    onClick={() => selectAnswer(candidate, "no")}
                  >
                    ✕ No, don't include it
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="toll-road-check__cta-bar">
          <button
            type="button"
            className="type-body-strong toll-road-check__cta"
            disabled={!allAnswered}
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
