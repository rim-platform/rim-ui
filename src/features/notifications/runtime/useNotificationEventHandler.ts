import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS, type NotificationDueBusEvent } from "../../../core/events/busEvents";
import { detectPlatform } from "../../../core/runtime/runtime";
import { toast } from "../../../shared/toast";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import type { Server } from "../../workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  notificationStyle,
  useNotificationSettingsStore,
} from "../state/useNotificationSettingsStore";
import { formatMessageNotification, showMessageNotification } from "./desktopNotification";
import { resolveNotificationContent } from "./resolveNotificationContent";

/** How long a notification id is remembered, so one that arrives on two streams shows once. */
const REPEAT_WINDOW_MS = 10_000;

/**
 * Whether `id` was already seen in the last {@link REPEAT_WINDOW_MS}; records it and forgets
 * entries past the window.
 *
 * @param seen - The ids seen so far with the time each was first seen; updated in place.
 * @param id - The notification id.
 * @param now - The current time in milliseconds.
 */
export function seenRecently(seen: Map<string, number>, id: string, now: number): boolean {
  for (const [key, at] of seen) {
    if (now - at >= REPEAT_WINDOW_MS) seen.delete(key);
  }
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

/**
 * Renders the notifications of every workspace that the server decided on (`NotificationDue`),
 * skipping one that arrives twice. The server applies levels, mutes, keywords and do-not-disturb;
 * this only honours `quiet` and the device-local settings (enabled, sound, and how a notification
 * looks). Call once from sign-in (AppShell).
 */
export function useNotificationEventHandler() {
  const qc = useQueryClient();
  const seen = useRef(new Map<string, number>());

  useEffect(() => {
    return eventBus.on<NotificationDueBusEvent>(BUS_EVENTS.NOTIFICATION_DUE, (payload) => {
      if (seenRecently(seen.current, payload.notificationId, Date.now())) return;
      void renderNotificationDue(qc, payload);
    });
  }, [qc]);
}

/**
 * The name to show on a notification of `workspaceId`: none for the open workspace, for a direct
 * space, or when the name is not known yet.
 */
export function otherWorkspaceName(qc: QueryClient, workspaceId: string): string | undefined {
  if (useWorkspaceStore.getState().workspaceId === workspaceId || isDirectSpace(workspaceId)) {
    return undefined;
  }
  const name =
    qc.getQueryData<Server[]>(queryKeys.myServers())?.find((s) => s.id === workspaceId)?.name ||
    useRelayStore.getState().spaces[workspaceId]?.name;
  return name || undefined;
}

/** Whether the viewer is looking at the conversation right now (no toast needed). */
export function isWatching(conversationId: string): boolean {
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
    encrypted: content.encrypted,
    workspaceName: otherWorkspaceName(qc, payload.workspaceId),
  };
  const style = notificationStyle(device);

  if (detectPlatform() === "desktop") {
    try {
      await showMessageNotification(message, style, device.soundEnabled);
    } catch {
      // The notification plugin can be unavailable; the inbox still has the entry.
    }
    return;
  }
  // No native notifications outside the desktop app: show an in-app toast instead.
  const { title, body } = formatMessageNotification(message, style);
  toast.info(title, { description: body });
}
