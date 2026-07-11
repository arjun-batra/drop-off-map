import "./SearchErrorScreen.css";

interface SearchErrorScreenProps {
  onTryAgain: () => void;
  onEditSearch: () => void;
}

/**
 * System/Network Failure State, docs/ux-spec.md section 7. Shown whenever
 * the `/api/drop-off-search` request itself fails (network error, auth
 * failure, provider outage, unexpected server error) rather than returning
 * a valid business-outcome response.
 */
export function SearchErrorScreen({ onTryAgain, onEditSearch }: SearchErrorScreenProps) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="app-shell">
      <div className="app-shell__container search-error-screen">
        <h2 className="type-h2">Something went wrong</h2>
        <p className="type-body search-error-screen__body">
          {offline
            ? "You appear to be offline. Check your connection and try again."
            : "We ran into a problem finding drop-off points. This is usually temporary."}
        </p>
        <button type="button" className="type-body-strong search-error-screen__retry" onClick={onTryAgain}>
          Try again
        </button>
        <button type="button" className="type-body search-error-screen__edit" onClick={onEditSearch}>
          ← Edit search
        </button>
      </div>
    </div>
  );
}
