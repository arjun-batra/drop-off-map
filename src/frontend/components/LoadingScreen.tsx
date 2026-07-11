import "./LoadingScreen.css";

interface LoadingScreenProps {
  onCancel: () => void;
}

/**
 * Screen 2 -- Loading State, docs/ux-spec.md section 5. Replaces the form
 * (not a modal over it) while `POST /api/drop-off-search` is in flight.
 *
 * ux-spec.md section 5 also calls for swapping the secondary line to
 * "Still working…" once the wait exceeds a threshold tied to tech-lead's
 * chosen request-timeout config -- that coordination point is explicitly
 * unresolved pending `REQUEST_TIMEOUT_MS`/orchestration-timeout work, which
 * design.md section 10 scopes to INC-7, not this increment. Deferred rather
 * than guessed; see docs/handoff.md's INC-6 section.
 */
export function LoadingScreen({ onCancel }: LoadingScreenProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__container loading-screen">
        <div className="loading-screen__spinner" role="status" aria-label="Loading" />
        <h2 className="type-h2">Finding the best drop-off points along your route…</h2>
        <p className="type-body-small loading-screen__secondary">Checking live traffic and transit data.</p>
        <button type="button" className="type-body loading-screen__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
