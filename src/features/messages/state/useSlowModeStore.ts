import { create } from "zustand";

type SlowModeState = {
  /**
   * Per conversation, the `Date.now()` before which the viewer's next message would hit slow
   * mode. Counted locally from the last send (or from a `RATE_LIMITED` answer); the server
   * stays the authority.
   */
  blockedUntil: Record<string, number>;
  /** Start the wait after a successful send into a slow-mode channel. */
  markSent: (conversationId: string, intervalSeconds: number) => void;
  /** The server said to wait `retryAfterSeconds`. */
  markRateLimited: (conversationId: string, retryAfterSeconds: number) => void;
};

export const useSlowModeStore = create<SlowModeState>((set) => ({
  blockedUntil: {},
  markSent: (conversationId, intervalSeconds) =>
    set((s) => ({
      blockedUntil: { ...s.blockedUntil, [conversationId]: Date.now() + intervalSeconds * 1000 },
    })),
  markRateLimited: (conversationId, retryAfterSeconds) =>
    set((s) => ({
      blockedUntil: {
        ...s.blockedUntil,
        [conversationId]: Date.now() + retryAfterSeconds * 1000,
      },
    })),
}));
