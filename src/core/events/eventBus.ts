/**
 * Simple typed event bus using a Map of event type to Set of callbacks.
 * Lives in core/ so that useWorkspaceEvents can publish raw events
 * without importing from features/. Each feature module registers
 * its own handler at startup.
 */

export type EventHandler<T = unknown> = (payload: T) => void;

const listeners = new Map<string, Set<EventHandler>>();

export const eventBus = {
  /**
   * Subscribe to an event type. Returns an unsubscribe function.
   */
  on<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    let set = listeners.get(eventType);
    if (!set) {
      set = new Set();
      listeners.set(eventType, set);
    }
    const typedHandler = handler as EventHandler;
    set.add(typedHandler);
    return () => {
      set!.delete(typedHandler);
      if (set!.size === 0) {
        listeners.delete(eventType);
      }
    };
  },

  /**
   * Emit an event. All registered handlers for the event type are called synchronously.
   */
  emit<T = unknown>(eventType: string, payload: T): void {
    const set = listeners.get(eventType);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  },
};
