import { useEffect } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { useUpdaterStore } from "../state/useUpdaterStore";

/** How often a running app checks for a new version. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The id of the "update available" toast, so repeated checks replace it. */
export const UPDATE_TOAST_ID = "updater-available";

/** Checks once and raises a toast when it finds a version not announced before. */
async function checkAndAnnounce(): Promise<void> {
  const store = useUpdaterStore.getState();
  const update = await store.checkNow();
  if (!update || useUpdaterStore.getState().notifiedVersion === update.version) return;
  useUpdaterStore.getState().markNotified(update.version);
  toast.info("Update available", {
    id: UPDATE_TOAST_ID,
    description: `Version ${update.version} is ready to download.`,
    persistent: true,
    action: {
      label: "View update",
      onClick: () => useShellStore.getState().setMainSurface({ kind: "settings", tab: "about" }),
    },
  });
}

/** Checks for updates at launch and every 24 hours, on a desktop build that is configured. */
export function useUpdateSchedule(): void {
  const { capabilities } = useRuntime();
  const supported = capabilities.updater;

  useEffect(() => {
    if (!supported) return;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void useUpdaterStore
      .getState()
      .loadStatus()
      .then((configured) => {
        if (!live || !configured) return;
        void checkAndAnnounce();
        timer = setInterval(() => void checkAndAnnounce(), UPDATE_CHECK_INTERVAL_MS);
      });
    return () => {
      live = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [supported]);
}
