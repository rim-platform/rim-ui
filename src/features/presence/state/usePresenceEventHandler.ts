import { useEffect } from "react";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type { PresenceChangedEvent } from "../../../core/events/busEvents";
import { usePresenceStore, PresenceStatus } from "./usePresenceStore";

/**
 * Registers event bus handler for presence change events.
 * Call once at app startup (e.g. in WorkspaceShell).
 */
export function usePresenceEventHandler() {
  useEffect(() => {
    const unsub = eventBus.on<PresenceChangedEvent>(
      BUS_EVENTS.PRESENCE_CHANGED,
      (payload) => {
        // Backend sends PascalCase ("Online"), store uses SCREAMING_CASE ("ONLINE")
        const upper = payload.status.toUpperCase();
        const validStatuses: Record<string, PresenceStatus> = {
          ONLINE: PresenceStatus.ONLINE,
          AWAY: PresenceStatus.AWAY,
          OFFLINE: PresenceStatus.OFFLINE,
        };
        const validated = validStatuses[upper];
        if (validated) {
          usePresenceStore.getState().setPresence(payload.userId, validated);
        }
      },
    );

    return unsub;
  }, []);
}
