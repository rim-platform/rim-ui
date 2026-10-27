import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "./Button";
import { logger } from "../../core/logger";
import { toast } from "../toast";
import { isChunkLoadError } from "../lazy/importWithRetry";

export interface SurfaceErrorBoundaryProps {
  /** Human-readable surface name shown in the fallback, e.g. "Conversation". */
  surface: string;
  /**
   * When any value in this array changes, the boundary clears its error and
   * re-renders children. Pass the id that identifies the surface's context
   * (conversationId, rootMessageId, …) so navigating away recovers automatically.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /** Optional custom report handler; defaults to logging via core logger. */
  onReport?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface SurfaceErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Contained, per-pane error boundary for RIM's shell surfaces (Conversation,
 * Thread, Tool panel, Settings, Audit log, …).
 *
 * Unlike the full-screen {@link https://react.dev/reference/react/Component AppErrorBoundary},
 * this renders a compact in-pane fallback so a crash in one surface doesn't
 * take down the rest of `WorkspaceShell` (the WS subscription, other panes,
 * `KeybindProvider`, etc. stay mounted). It sits between the app boundary and
 * the plugin boundaries.
 *
 * Always pass `resetKeys` scoped to the surface's identity (e.g. the active
 * conversation id) — without it, a crashed pane stays crashed even after the
 * user navigates away, because React error boundaries do not auto-recover.
 *
 * A chunk of the app that could not be fetched shows Reload instead of Retry, which would throw
 * the same failed import.
 */
export class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  constructor(props: SurfaceErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): Partial<SurfaceErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error(`[RIM:Surface] ${this.props.surface} crashed`, error, info);
    this.setState({ info });
  }

  componentDidUpdate(prevProps: SurfaceErrorBoundaryProps) {
    if (!this.state.error) return;
    if (haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null, info: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null, info: null });
  };

  handleReport = () => {
    const { error, info } = this.state;
    if (!error || !info) return;
    if (this.props.onReport) {
      this.props.onReport(error, info);
    } else {
      logger.error(`[RIM:Surface] ${this.props.surface} reported`, error, info);
    }
    // No backend telemetry endpoint exists yet — Report only logs locally
    // (via logger.error or the caller's onReport), so the toast must not
    // claim the error was transmitted anywhere.
    toast.success("Error details logged");
  };

  render() {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      return (
        <div className="rounded-xl border border-rim-danger/20 bg-rim-panel p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rim-danger" />
            <h2 className="text-sm font-semibold text-rim-danger">
              This part of the app could not load
            </h2>
          </div>
          <p className="mt-3 text-sm text-rim-text-muted">
            The connection dropped while it loaded. Reload to try again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-xl border border-rim-danger/20 bg-rim-panel p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rim-danger" />
            <h2 className="text-sm font-semibold text-rim-danger">
              {this.props.surface} failed to load
            </h2>
          </div>
          <pre className="mt-3 overflow-auto rounded-lg bg-rim-void p-3 text-xs text-rim-text-muted">
            {import.meta.env.DEV
              ? error.message
              : "An unexpected error occurred. Details have been logged."}
          </pre>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={this.handleRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={this.handleReport}>
              Report
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function haveResetKeysChanged(
  prev: ReadonlyArray<unknown> | undefined,
  next: ReadonlyArray<unknown> | undefined,
): boolean {
  if (prev === next) return false;
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => value !== next[index]);
}
