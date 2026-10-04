import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
          <div className="max-w-md space-y-4 rounded-xl border border-rim-danger/20 bg-rim-panel p-6 text-center">
            <h1 className="text-lg font-semibold text-rim-danger">UI ERROR</h1>
            <p className="text-sm text-rim-text-muted">The app hit a render error</p>
            <pre className="overflow-auto rounded-lg bg-rim-void p-3 text-left text-xs text-rim-danger">
              {this.state.error.message}
            </pre>
            <p className="text-xs text-rim-text-faint">
              The detailed stack is also logged to the browser console.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-lg bg-rim-accent px-4 py-1.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-rim-line px-4 py-1.5 text-sm font-medium text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
