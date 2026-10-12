/**
 * This relay's direct space, live from sign-in whichever space is open: its unread counts, its
 * unread notification count, its `workspaceEvents` subscription (restored on reconnect like the
 * open space's) and the notifications the server sends there. Starts once `relayInfo` answers.
 */

import { useWorkspaceEvents } from "../../../core/events/useWorkspaceEvents";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useUnreadCounts } from "../../conversations/api/useUnreadCounts";
import { useUnreadNotificationCount } from "../../notifications/api/useNotifications";
import { useNotificationEventHandler } from "../../notifications/runtime/useNotificationEventHandler";
import { useRelayStore } from "../state/useRelayStore";

/** This relay's direct space id, once there is a session and `relayInfo` has answered. */
export function useLocalDirectSpaceId(): string | null {
  const signedIn = useAuthStore((s) => s.session !== null);
  const directSpaceId = useRelayStore((s) => s.info?.directSpaceId ?? null);
  return signedIn ? directSpaceId : null;
}

export function useDirectSpaceRuntime(): void {
  const directSpaceId = useLocalDirectSpaceId();
  useWorkspaceEvents(directSpaceId);
  useUnreadCounts(directSpaceId ?? undefined);
  useUnreadNotificationCount(directSpaceId);
  useNotificationEventHandler(directSpaceId);
}
