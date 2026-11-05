import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { fetchUnreadNotificationCount } from "../../notifications/api/useNotifications";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { useLocalDirectSpaceId } from "../../relay/runtime/useDirectSpaceRuntime";
import { useUpdaterStore } from "../../updater/state/useUpdaterStore";
import { useMyServers } from "../../workspaces/api/useMyServers";
import {
  desktopSetTrayState,
  desktopTrayShown,
  TRAY_ACTION_EVENT,
  TRAY_SHOWN_EVENT,
  type TrayAction,
  type TrayShown,
} from "../api/desktopShell";

/** How often the counts are read while the tray icon shows, whether the window is hidden or not. */
const COUNT_POLL_MS = 60_000;

/** How long a read count counts as fresh. */
const COUNT_STALE_MS = 30_000;

/**
 * Subscribes to `event`, for as long as the returned cleanup has not run.
 *
 * @returns The cleanup, and a promise that settles once the subscription exists or failed.
 */
function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): { stop: () => void; ready: Promise<void> } {
  let live = true;
  let unlisten: (() => void) | undefined;
  const ready = listen<T>(event, (e) => handler(e.payload)).then(
    (stop) => {
      if (live) unlisten = stop;
      else stop();
    },
    (error: unknown) => {
      logger.warn(`[RIM:desktop] could not listen for ${event}:`, error);
    },
  );
  return {
    stop: () => {
      live = false;
      unlisten?.();
    },
    ready,
  };
}

/** Whether the tray icon shows now, from the desktop app's answer and its later events. */
function useTrayShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    let heardEvent = false;
    const { stop, ready } = subscribe<TrayShown>(TRAY_SHOWN_EVENT, (payload) => {
      heardEvent = true;
      setShown(payload.shown);
    });
    void ready
      .then(() => desktopTrayShown())
      .then((value) => {
        if (live && !heardEvent) setShown(value);
      })
      .catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not ask whether the tray icon shows:", error);
      });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return shown;
}

/**
 * Whether anything the person would be notified about is unread, in the workspaces and the direct
 * space. The counts are read only while `active`, and in the background too. They do not retry:
 * a retry waits for the window to be shown, which would stop the polling while it is hidden.
 *
 * @param active - Whether to read the counts.
 * @returns Whether any count known so far is above zero.
 */
function useAnyUnreadNotification(active: boolean): boolean {
  const { data: servers } = useMyServers(active);
  const directSpaceId = useLocalDirectSpaceId();
  const spaceIds = useMemo(() => {
    const ids = new Set((servers ?? []).map((server) => server.id));
    if (directSpaceId) ids.add(directSpaceId);
    return [...ids];
  }, [servers, directSpaceId]);
  return useQueries({
    queries: spaceIds.map((id) => ({
      queryKey: queryKeys.unreadNotificationCount(id),
      queryFn: () => fetchUnreadNotificationCount(id),
      enabled: active,
      refetchInterval: COUNT_POLL_MS,
      refetchIntervalInBackground: true,
      staleTime: COUNT_STALE_MS,
      retry: false,
    })),
    combine: (results) => results.some((result) => (result.data ?? 0) > 0),
  });
}

/**
 * Keeps the tray icon in step with the page: the dot while notifications are on and something is
 * unread (never a count), and "Restart to update" while an update is ready. It also carries out
 * that menu item, because the updater store holds the downloaded update. Failures are logged and
 * never shown, because this runs in the background.
 */
export function useTrayState(): void {
  const shown = useTrayShown();
  const signedIn = useAuthStore((s) => s.session !== null);
  const anyUnread = useAnyUnreadNotification(shown && signedIn);
  const notificationsOn = useNotificationSettingsStore((s) => s.enabled);
  const updateReady = useUpdaterStore((s) => s.activity === "ready");
  const dot = signedIn && notificationsOn && anyUnread;

  useEffect(() => {
    desktopSetTrayState(dot, updateReady).catch((error: unknown) => {
      logger.warn("[RIM:desktop] could not update the tray icon:", error);
    });
  }, [dot, updateReady]);

  useEffect(() => {
    return subscribe<TrayAction>(TRAY_ACTION_EVENT, (payload) => {
      if (payload.action !== "restart-to-update") return;
      useUpdaterStore
        .getState()
        .restartToUpdate()
        .catch((error: unknown) => {
          logger.warn("[RIM:desktop] could not restart to update:", error);
        });
    }).stop;
  }, []);
}
