import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// React error boundaries must be class components — there's no hook
// equivalent (as of React 19) for catching render-time errors in a subtree.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
          <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="max-w-md text-ink/70">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-crate px-4 py-2 font-medium text-white hover:bg-crate-dark"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
