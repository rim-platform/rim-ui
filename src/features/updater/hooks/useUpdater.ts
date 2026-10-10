import { useEffect } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useUpdaterStore, type AvailableUpdate, type UpdaterState } from "../state/useUpdaterStore";

/**
 * Where the updater stands, for the UI:
 * - `unsupported`: this runtime does not update itself (the web).
 * - `loading`: the shell has not said yet whether this build is configured.
 * - `unconfigured`: the build has no update endpoint or key.
 * - `idle`: configured, not checked yet.
 * - `upToDate`: the last check found nothing newer.
 * - `available`: a newer version is offered and not downloaded.
 * - `error`: the last check, download or install failed.
 * - `checking`, `downloading`, `ready` (downloaded, waiting for a restart), `installing`.
 */
export type UpdaterStatus =
  | "unsupported"
  | "loading"
  | "unconfigured"
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdaterView {
  status: UpdaterStatus;
  available: AvailableUpdate | null;
  /** Download progress from 0 to 1, or null when unknown or not downloading. */
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  check: () => Promise<AvailableUpdate | null>;
  download: () => Promise<void>;
  restart: () => Promise<void>;
}

function statusOf(state: UpdaterState): UpdaterStatus {
  if (state.configured === null) return "loading";
  if (!state.configured) return "unconfigured";
  if (state.activity !== "idle") return state.activity;
  if (state.error) return "error";
  if (state.available) return "available";
  if (state.lastCheckedAt !== null) return "upToDate";
  return "idle";
}

function fractionOf(state: UpdaterState): number | null {
  const progress = state.progress;
  if (!progress || !progress.total) return null;
  return Math.min(1, progress.downloaded / progress.total);
}

/** The app updater's state and actions; reads whether the build is configured on first use. */
export function useUpdater(): UpdaterView {
  const { capabilities } = useRuntime();
  const supported = capabilities.updater;
  const status = useUpdaterStore(statusOf);
  const progress = useUpdaterStore(fractionOf);
  const available = useUpdaterStore((s) => s.available);
  const error = useUpdaterStore((s) => s.error);
  const lastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const configured = useUpdaterStore((s) => s.configured);
  const loadStatus = useUpdaterStore((s) => s.loadStatus);
  const check = useUpdaterStore((s) => s.checkNow);
  const download = useUpdaterStore((s) => s.download);
  const restart = useUpdaterStore((s) => s.restartToUpdate);

  useEffect(() => {
    if (supported && configured === null) void loadStatus();
  }, [supported, configured, loadStatus]);

  return {
    status: supported ? status : "unsupported",
    available,
    progress,
    error,
    lastCheckedAt,
    check,
    download,
    restart,
  };
}
