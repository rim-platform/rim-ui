import { useEffect } from "react";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type { TypingStartedEvent, TypingStoppedEvent } from "../../../core/events/busEvents";
import { useTypingStore } from "./useTypingStore";
import { useAuthStore } from "../../auth/state/useAuthStore";

/**
 * Registers the event bus handlers for typing indicator starts and stops.
 * Call once at app startup (e.g. in WorkspaceShell).
 */
export function useTypingEventHandler() {
  useEffect(() => {
    const offStarted = eventBus.on<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, (payload) => {
      const currentUserId = useAuthStore.getState().session?.userId;
      if (payload.userId !== currentUserId) {
        useTypingStore
          .getState()
          .addTyping(payload.conversationId, payload.userId, payload.username);
      }
    });
    const offStopped = eventBus.on<TypingStoppedEvent>(BUS_EVENTS.TYPING_STOPPED, (payload) => {
      useTypingStore.getState().removeTyping(payload.conversationId, payload.userId);
    });

    return () => {
      offStarted();
      offStopped();
    };
  }, []);
}
