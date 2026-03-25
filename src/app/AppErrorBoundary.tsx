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
          <div className="max-w-md space-y-4 rounded-xl border border-red-400/20 bg-rim-panel p-6 text-center">
            <h1 className="text-lg font-semibold text-red-300">UI ERROR</h1>
            <p className="text-sm text-rim-text-muted">The app hit a render error</p>
            <pre className="overflow-auto rounded-lg bg-rim-void p-3 text-left text-xs text-red-200">
              {this.state.error.message}
            </pre>
            <p className="text-xs text-rim-text-faint">
              Refresh the app after this error is fixed. The detailed stack is also logged to the browser console.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
