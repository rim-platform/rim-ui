import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type { NewMessageNotificationEvent } from "../../../core/events/busEvents";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMutedStore } from "../../conversations/state/useMutedStore";
import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { showMessageNotification } from "./desktopNotification";
import { queryKeys } from "../../../core/query/keys";

interface ConversationCachePage {
  items: { id: string; title: string; conversationType: string }[];
}

interface ServerMemberCache {
  userId: string;
  username: string;
}

/**
 * Registers event bus handler for desktop notification events.
 * Call once at app startup (e.g. in WorkspaceShell).
 */
export function useNotificationEventHandler(workspaceId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;

    const unsub = eventBus.on<NewMessageNotificationEvent>(
      BUS_EVENTS.NEW_MESSAGE_NOTIFICATION,
      (payload) => {
        const currentUserId = useAuthStore.getState().session?.userId;
        const isOwnMessage = payload.authorId === currentUserId;
        const isActiveConversation =
          payload.conversationId === useShellStore.getState().selectedConversationId;

        if (isOwnMessage || isActiveConversation) return;

        const isMuted = useMutedStore.getState().isMuted(payload.conversationId);
        const notifSettings = useNotificationSettingsStore.getState();
        if (!notifSettings.enabled || isMuted) return;

        const channelName = resolveConversationName(qc, workspaceId, payload.conversationId);
        const authorName = resolveMemberName(qc, workspaceId, payload.authorId);

        showMessageNotification({
          channelName,
          authorName,
          messageText: payload.messageText,
          showPreview: notifSettings.showPreview,
        }).catch(() => {
          // Notification API may not be available (web mode)
        });
      },
    );

    return unsub;
  }, [workspaceId, qc]);
}

function resolveConversationName(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
): string {
  const channels = qc.getQueryData<ConversationCachePage>(queryKeys.channels(workspaceId));
  const inbox = qc.getQueryData<ConversationCachePage>(queryKeys.conversations(workspaceId));
  const all = [...(channels?.items ?? []), ...(inbox?.items ?? [])];
  const conv = all.find((c) => c.id === conversationId);
  return conv?.title || "New message";
}

function resolveMemberName(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  userId: string,
): string {
  const members = qc.getQueryData<ServerMemberCache[]>(queryKeys.serverMembers(workspaceId));
  const member = members?.find((m) => m.userId === userId);
  return member?.username ?? userId.slice(0, 8);
}
