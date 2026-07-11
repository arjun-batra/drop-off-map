import { useEffect, useState } from "react";
import type { PublicConfig } from "../config/schema";
import { fetchPublicConfig } from "./api";
import { PasswordGate } from "./components/PasswordGate";
import { SearchFlow } from "./components/SearchFlow";
import { clearClientSessionFlag, hasClientSessionFlag } from "./sessionFlag";

type AppState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; config: PublicConfig; authenticated: boolean };

export function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchPublicConfig()
      .then((config) => {
        if (cancelled) return;
        const authenticated = config.appMode === "free_tier" || hasClientSessionFlag();
        setState({ status: "ready", config, authenticated });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <CenteredMessage title="Loading DropSpot…" />;
  }

  if (state.status === "error") {
    return (
      <CenteredMessage
        title="Something went wrong"
        body="We couldn't reach DropSpot's server. Check your connection and reload the page."
      />
    );
  }

  if (state.config.appMode === "paid_tier" && !state.authenticated) {
    return (
      <PasswordGate
        onSuccess={() => setState({ status: "ready", config: state.config, authenticated: true })}
      />
    );
  }

  return (
    <SearchFlow
      config={state.config}
      onSessionExpired={() => {
        // REV-002/INC-8: the session cookie genuinely expires now (unlike
        // the previous non-expiring token), so this is a real, reachable
        // path, not just defensive code. Drop back to the Password Gate
        // rather than showing a generic failure screen for what is really
        // an auth problem -- matches FR-016's "entire app... requires a
        // correct password" for the re-authenticated state too.
        clearClientSessionFlag();
        setState({ status: "ready", config: state.config, authenticated: false });
      }}
    />
  );
}

interface CenteredMessageProps {
  title: string;
  body?: string;
}

function CenteredMessage({ title, body }: CenteredMessageProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__container" style={{ textAlign: "center", paddingTop: "3rem" }}>
        <h1 className="type-h2">{title}</h1>
        {body && <p className="type-body">{body}</p>}
      </div>
    </div>
  );
}
