import { Component, type ErrorInfo, type ReactNode } from "react";

import { ErrorState } from "@/components/query-states";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches errors thrown while rendering, so a bug in one screen shows a message
 * with a way back instead of leaving the whole window blank.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      </div>
    );
  }
}
