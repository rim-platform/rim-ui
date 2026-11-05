import type { QueryClient } from "@tanstack/react-query";

import { BUS_EVENTS, type NotificationDueBusEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
import type { WorkspaceEvent } from "../../../core/events/types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  invalidateNotificationInbox,
  invalidateUnreadNotificationCount,
} from "../api/useNotifications";

/**
 * Realtime handlers for the notification inbox, called from `useWorkspaceEvents` and
 * `useNotificationEvents`.
 */

type NotificationDueEvent = Extract<WorkspaceEvent, { type: "NotificationDue" }>;

function currentUserId(qc: QueryClient): string | undefined {
  return (
    useAuthStore.getState().session?.userId ?? qc.getQueryData<{ id: string }>(queryKeys.me)?.id
  );
}

/**
 * The server stored a notification for the viewer: refresh that workspace's badges and inbox, then
 * hand it to the renderer (`useNotificationEventHandler`) through the bus.
 */
export function announceNotificationDue(qc: QueryClient, due: NotificationDueBusEvent): void {
  invalidateNotificationInbox(qc, due.workspaceId);
  // A workspace that is not open sends no message events here, so its rail badge reads the count.
  const open = useWorkspaceStore.getState().workspaceId === due.workspaceId;
  if (!open && !isDirectSpace(due.workspaceId)) {
    void qc.invalidateQueries({ queryKey: queryKeys.unreadCounts(due.workspaceId) });
  }
  eventBus.emit<NotificationDueBusEvent>(BUS_EVENTS.NOTIFICATION_DUE, due);
}

/** Maps a workspace's `NotificationDue` event to the announcement. */
export function handleNotificationDue(
  qc: QueryClient,
  workspaceId: string,
  event: NotificationDueEvent,
): void {
  announceNotificationDue(qc, {
    workspaceId,
    notificationId: event.notification_id,
    conversationId: event.conversation_id,
    messageId: event.message_id,
    reason: event.reason,
    quiet: event.quiet,
  });
}

/** The viewer read a conversation (here or on another device), which clears its entries. */
export function handleReadStateUpdated(qc: QueryClient, workspaceId: string): void {
  invalidateUnreadNotificationCount(qc, workspaceId);
}

/** Messages were deleted in bulk: the server dropped their unread entries, so refetch the count and the lists. */
export function handleMessagesDeleted(qc: QueryClient, workspaceId: string): void {
  invalidateNotificationInbox(qc, workspaceId);
}

/**
 * The viewer left or was removed from a conversation or the workspace: entries they can no
 * longer read change (`conversation`/`message` turn null), so refetch the count and the lists.
 */
export function handleViewerMembershipChange(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
): void {
  if (userId !== currentUserId(qc)) return;
  invalidateNotificationInbox(qc, workspaceId);
}
