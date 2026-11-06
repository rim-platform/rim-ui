import { useEffect } from "react";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type {
  UnreadIncrementEvent,
  UnreadMarkReadEvent,
  UnreadRewoundEvent,
} from "../../../core/events/busEvents";
import { useUnreadStore } from "./useUnreadStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";

/**
 * Keeps automatic marking off a conversation just marked unread while it stays open. One that
 * is not open is read as usual when it next opens.
 */
export function holdIfOpen(conversationId: string): void {
  if (useShellStore.getState().selectedConversationId === conversationId) {
    useUnreadStore.getState().setHeld(conversationId);
  }
}

/**
 * Registers event bus handlers for unread-related events.
 * Call once at app startup (e.g. in WorkspaceShell).
 */
export function useUnreadEventHandler() {
  useEffect(() => {
    const unsubIncrement = eventBus.on<UnreadIncrementEvent>(
      BUS_EVENTS.UNREAD_INCREMENT,
      (payload) => {
        const currentUserId = useAuthStore.getState().session?.userId;
        const isOwnMessage = payload.authorId === currentUserId;
        const isActiveConversation =
          payload.conversationId === useShellStore.getState().selectedConversationId;

        if (!isOwnMessage && !isActiveConversation) {
          useUnreadStore.getState().increment(payload.conversationId, payload.workspaceId);
        }
      },
    );

    const unsubMarkRead = eventBus.on<UnreadMarkReadEvent>(
      BUS_EVENTS.UNREAD_MARK_READ,
      (payload) => {
        useUnreadStore.getState().markRead(payload.conversationId);
      },
    );

    const unsubRewound = eventBus.on<UnreadRewoundEvent>(BUS_EVENTS.UNREAD_REWOUND, (payload) => {
      holdIfOpen(payload.conversationId);
    });

    return () => {
      unsubIncrement();
      unsubMarkRead();
      unsubRewound();
    };
  }, []);
}
