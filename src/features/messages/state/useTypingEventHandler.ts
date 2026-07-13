import { useEffect } from "react";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type { TypingStartedEvent } from "../../../core/events/busEvents";
import { useTypingStore } from "./useTypingStore";
import { useAuthStore } from "../../auth/state/useAuthStore";

/**
 * Registers event bus handler for typing indicator events.
 * Call once at app startup (e.g. in WorkspaceShell).
 */
export function useTypingEventHandler() {
  useEffect(() => {
    const unsub = eventBus.on<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, (payload) => {
      const currentUserId = useAuthStore.getState().session?.userId;
      if (payload.userId !== currentUserId) {
        useTypingStore
          .getState()
          .addTyping(payload.conversationId, payload.userId, payload.username);
      }
    });

    return unsub;
  }, []);
}
