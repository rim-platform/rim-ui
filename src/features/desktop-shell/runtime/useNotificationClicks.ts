import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { onAction } from "@tauri-apps/plugin-notification";

import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { MessageNotificationTarget } from "../../notifications/runtime/desktopNotification";
import { jumpToNotification } from "../../notifications/runtime/jumpToNotification";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { desktopShowWindow } from "../api/desktopShell";

/** The parts of a notification action this reads. */
interface NotificationAction {
  actionId: string;
  notification: { extra?: Record<string, unknown> } | null;
}

/** `extra.rimMessage` as a target, or null when it is not one. */
function targetOf(value: unknown): MessageNotificationTarget | null {
  if (typeof value !== "object" || value === null) return null;
  const { workspaceId, conversationId, messageId, threadId } = value as Record<string, unknown>;
  if (
    typeof workspaceId !== "string" ||
    typeof conversationId !== "string" ||
    typeof messageId !== "string" ||
    (typeof threadId !== "string" && threadId !== null && threadId !== undefined)
  ) {
    return null;
  }
  return { workspaceId, conversationId, messageId, threadId: threadId ?? null };
}

/** `extra.rimAgentSession`'s key, or null when it is not one. */
function agentSessionKeyOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { key } = value as Record<string, unknown>;
  return typeof key === "string" && key !== "" ? key : null;
}

/**
 * Answers a click on a notification: the window always shows. With a session, a message
 * notification also opens its message, in its workspace, and an agent session's opens that
 * session.
 *
 * @param qc - The app's query client.
 * @param event - The action the plugin reported; anything but a click on the notification itself
 * does nothing.
 */
async function openFromNotification(qc: QueryClient, event: NotificationAction): Promise<void> {
  if (event.actionId !== "tap") return;
  desktopShowWindow().catch((error: unknown) => {
    logger.warn("[RIM:desktop] could not show the window for a notification:", error);
  });
  if (!useAuthStore.getState().session) return;
  const sessionKey = agentSessionKeyOf(event.notification?.extra?.rimAgentSession);
  if (sessionKey) {
    useShellStore.getState().setMainSurface({ kind: "agent-session", key: sessionKey });
    return;
  }
  const target = targetOf(event.notification?.extra?.rimMessage);
  if (!target) return;
  const workspaces = useWorkspaceStore.getState();
  if (workspaces.workspaceId !== target.workspaceId) workspaces.setWorkspaceId(target.workspaceId);
  await jumpToNotification(qc, {
    serverId: target.workspaceId,
    conversationId: target.conversationId,
    messageId: target.messageId,
    threadId: target.threadId,
  });
}

/**
 * Listens for clicks on notifications for as long as it is mounted. The plugin only reports clicks
 * on notifications shown while a listener exists, so this mounts before any is sent.
 */
export function useNotificationClicks(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    const warn = (error: unknown) => {
      logger.warn("[RIM:desktop] could not stop listening for notification clicks:", error);
    };
    onAction((event) => {
      openFromNotification(qc, event).catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not open a notification:", error);
      });
    }).then(
      (listener) => {
        if (live) stop = () => listener.unregister();
        else listener.unregister().catch(warn);
      },
      (error: unknown) => {
        logger.warn("[RIM:desktop] could not listen for notification clicks:", error);
      },
    );
    return () => {
      live = false;
      stop?.().catch(warn);
    };
  }, [qc]);
}
