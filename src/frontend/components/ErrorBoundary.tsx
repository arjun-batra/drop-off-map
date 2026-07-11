import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Generic render-error boundary. Only class components can implement React's
 * error-boundary lifecycle (`getDerivedStateFromError`/`componentDidCatch`)
 * -- there is no hooks equivalent.
 *
 * Used by SearchFlow.tsx to isolate ResultsScreen's data-dependent rendering
 * (candidate cards, trip-summary interpolation, etc. -- all of which read
 * fields off the backend response) from the FR-014 disclaimer banner,
 * rendered as a sibling *outside* this boundary. Per ux-spec.md section
 * 6.2's resilience requirement ("must render even if other rendering
 * fails") and REV-012's finding, a bug or malformed-data crash inside
 * ResultsScreen must never be able to take the disclaimer down with it --
 * wrapping only ResultsScreen (not the disclaimer) in this boundary is what
 * makes that structurally true, not just conventionally true.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    console.error("[ErrorBoundary] caught a render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
