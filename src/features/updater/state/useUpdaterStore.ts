import { create } from "zustand";

import { logger } from "../../../core/logger";
import {
  checkForUpdate,
  fetchUpdaterConfigured,
  relaunchApp,
  type DownloadEvent,
  type Update,
} from "../api/updaterApi";

/** A newer version the update endpoint offers. */
export interface AvailableUpdate {
  version: string;
  notes: string | null;
  date: string | null;
}

/** Bytes of the update fetched so far; `total` is null when the server sent no length. */
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

/** What the updater is doing right now. */
export type UpdaterActivity = "idle" | "checking" | "downloading" | "ready" | "installing";

interface UpdaterData {
  /** Whether this build can update; null until the shell answers. */
  configured: boolean | null;
  activity: UpdaterActivity;
  available: AvailableUpdate | null;
  progress: DownloadProgress | null;
  lastCheckedAt: number | null;
  error: string | null;
  /** The plugin's handle on the offered update, which downloads and installs it. */
  handle: Update | null;
  /** The last version a notice announced, so a daily check does not repeat it. */
  notifiedVersion: string | null;
}

interface UpdaterActions {
  /** Reads whether this build is configured, once; later calls reuse the answer. */
  loadStatus: () => Promise<boolean>;
  /** Checks for a newer version, unless a check, download or install is under way. */
  checkNow: () => Promise<AvailableUpdate | null>;
  /** Downloads the offered update without installing it. */
  download: () => Promise<void>;
  /** Installs the downloaded update and restarts into it. */
  restartToUpdate: () => Promise<void>;
  markNotified: (version: string) => void;
}

export type UpdaterState = UpdaterData & UpdaterActions;

export const initialUpdaterData: UpdaterData = {
  configured: null,
  activity: "idle",
  available: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  handle: null,
  notifiedVersion: null,
};

let statusRequest: Promise<boolean> | null = null;

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function toAvailable(update: Update): AvailableUpdate {
  return { version: update.version, notes: update.body ?? null, date: update.date ?? null };
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  ...initialUpdaterData,

  loadStatus: () => {
    const known = get().configured;
    if (known !== null) return Promise.resolve(known);
    statusRequest ??= fetchUpdaterConfigured()
      .catch((err: unknown) => {
        logger.warn("[updater] status unavailable:", err);
        return false;
      })
      .then((configured) => {
        set({ configured });
        return configured;
      })
      .finally(() => {
        statusRequest = null;
      });
    return statusRequest;
  },

  checkNow: async () => {
    const { configured, activity, available } = get();
    if (!configured || activity !== "idle") return available;
    set({ activity: "checking", error: null });
    try {
      const update = await checkForUpdate();
      const previous = get().handle;
      if (previous && previous !== update) {
        void previous.close().catch(() => undefined);
      }
      const next = update ? toAvailable(update) : null;
      set({
        activity: "idle",
        available: next,
        handle: update,
        progress: null,
        lastCheckedAt: Date.now(),
      });
      return next;
    } catch (err) {
      set({ activity: "idle", error: describe(err) });
      return get().available;
    }
  },

  download: async () => {
    const { handle, activity } = get();
    if (!handle || activity !== "idle") return;
    set({ activity: "downloading", error: null, progress: { downloaded: 0, total: null } });
    const onEvent = (event: DownloadEvent) => {
      const progress = get().progress ?? { downloaded: 0, total: null };
      if (event.event === "Started") {
        set({ progress: { downloaded: 0, total: event.data.contentLength ?? null } });
      } else if (event.event === "Progress") {
        set({
          progress: { ...progress, downloaded: progress.downloaded + event.data.chunkLength },
        });
      }
    };
    try {
      await handle.download(onEvent);
      set({ activity: "ready" });
    } catch (err) {
      set({ activity: "idle", progress: null, error: describe(err) });
    }
  },

  markNotified: (version) => set({ notifiedVersion: version }),

  restartToUpdate: async () => {
    const { handle, activity } = get();
    if (!handle || activity !== "ready") return;
    set({ activity: "installing", error: null });
    try {
      await handle.install();
      await relaunchApp();
    } catch (err) {
      set({ activity: "idle", progress: null, error: describe(err) });
    }
  },
}));
