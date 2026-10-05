import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS, type NotificationDueBusEvent } from "../../../core/events/busEvents";
import { detectPlatform } from "../../../core/runtime/runtime";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import { notificationBody, showMessageNotification } from "./desktopNotification";
import { resolveNotificationContent } from "./resolveNotificationContent";

/**
 * Renders the notifications the server decided on (`NotificationDue`, Track 1.3). The server
 * applies levels, mutes, keywords and do-not-disturb; this only honours `quiet` and the
 * device-local toggles (enabled, sound, preview). Call once at app startup (AppShell).
 */
export function useNotificationEventHandler(workspaceId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;

    return eventBus.on<NotificationDueBusEvent>(BUS_EVENTS.NOTIFICATION_DUE, (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      void renderNotificationDue(qc, payload);
    });
  }, [workspaceId, qc]);
}

/** Whether the viewer is looking at the conversation right now (no toast needed). */
function isWatching(conversationId: string): boolean {
  const shell = useShellStore.getState();
  return (
    shell.mainSurface.kind === "conversation" &&
    shell.selectedConversationId === conversationId &&
    document.hasFocus()
  );
}

export async function renderNotificationDue(
  qc: QueryClient,
  payload: NotificationDueBusEvent,
): Promise<void> {
  // Inside do-not-disturb the notification is stored (inbox, digest) but not announced.
  if (payload.quiet) return;
  const device = useNotificationSettingsStore.getState();
  if (!device.enabled || isWatching(payload.conversationId)) return;

  const content = await resolveNotificationContent(
    qc,
    payload.workspaceId,
    payload.conversationId,
    payload.messageId,
  );
  const message = {
    channelName: content.title,
    authorName: content.authorName,
    messageText: content.text,
    showPreview: device.showPreview,
  };

  if (detectPlatform() === "desktop") {
    try {
      await showMessageNotification({ ...message, sound: device.soundEnabled });
    } catch {
      // The notification plugin can be unavailable; the inbox still has the entry.
    }
    return;
  }
  // No native notifications outside the desktop app: show an in-app toast instead.
  toast.info(content.title, { description: notificationBody(message) });
}
