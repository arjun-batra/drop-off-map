import { useEffect, useState } from "react";
import "./LoadingScreen.css";

interface LoadingScreenProps {
  onCancel: () => void;
  /**
   * design.md section 6.3/7's RESPONSE_TIME_TARGET_SECONDS -- the same
   * value the backend's orchestration deadline (api/drop-off-search.ts) is
   * derived from, threaded through `GET /api/config/public` so this
   * threshold isn't a second, independently-guessed constant (ux-spec.md
   * section 5's own open-questions note explicitly calls out that this
   * threshold "should match whatever request timeout tech-lead configures
   * server-side").
   */
  responseTimeTargetSeconds: number;
}

/**
 * Screen 2 -- Loading State, docs/ux-spec.md section 5. Replaces the form
 * (not a modal over it) while `POST /api/drop-off-search` is in flight.
 *
 * Per ux-spec.md section 5 / design.md section 6.3 (INC-7): once the wait
 * exceeds `responseTimeTargetSeconds`, the secondary line swaps to "Still
 * working — this is taking a little longer than usual." This is a pure
 * client-side timer (does not itself cancel/detect a real timeout -- the
 * backend's own orchestration deadline, and this endpoint's `status:
 * "timeout"` response, are what actually resolve a slow request; this is
 * only the copy change while still waiting, per ux-spec.md's explicit "do
 * not show an error until the request actually fails" rule).
 */
export function LoadingScreen({ onCancel, responseTimeTargetSeconds }: LoadingScreenProps) {
  const [stillWorking, setStillWorking] = useState(false);

  useEffect(() => {
    setStillWorking(false);
    if (!Number.isFinite(responseTimeTargetSeconds) || responseTimeTargetSeconds <= 0) return;

    const timer = window.setTimeout(() => setStillWorking(true), responseTimeTargetSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [responseTimeTargetSeconds]);

  return (
    <div className="app-shell">
      <div className="app-shell__container loading-screen">
        <div className="loading-screen__spinner" role="status" aria-label="Loading" />
        <h2 className="type-h2">Finding the best drop-off points along your route…</h2>
        <p className="type-body-small loading-screen__secondary">
          {stillWorking ? "Still working — this is taking a little longer than usual." : "Checking live traffic and transit data."}
        </p>
        <button type="button" className="type-body loading-screen__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
