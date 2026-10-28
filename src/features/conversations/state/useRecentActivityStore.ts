import { create } from "zustand";

import { useAuthStore } from "../../auth/state/useAuthStore";

/** Most places the log keeps. */
export const RECENT_ACTIVITY_LIMIT = 20;

/** A place where someone else posted: a conversation, or one thread of it. */
export interface RecentActivityEntry {
  workspaceId: string;
  conversationId: string;
  threadId: string | null;
  /** When it happened, in milliseconds; 0 for a place known only from the conversation list. */
  at: number;
}

interface RecentActivityState {
  /** The places, newest first, one per workspace, conversation and thread. */
  entries: RecentActivityEntry[];
  /** Counts the messages recorded, so a walk through the log can tell that a new one arrived. */
  revision: number;
  /** Move the place of a message to the front. Does nothing for a message of the signed-in user. */
  record: (place: Omit<RecentActivityEntry, "at"> & { authorId: string; at?: number }) => void;
  /** Add places to the end of the log, leaving the ones it already has as they are. */
  seed: (places: readonly RecentActivityEntry[]) => void;
  reset: () => void;
}

function samePlace(a: RecentActivityEntry, b: RecentActivityEntry): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.conversationId === b.conversationId &&
    a.threadId === b.threadId
  );
}

export const useRecentActivityStore = create<RecentActivityState>((set) => ({
  entries: [],
  revision: 0,
  record: ({ authorId, at, ...place }) => {
    if (authorId === useAuthStore.getState().session?.userId) return;
    const entry: RecentActivityEntry = { ...place, at: at ?? Date.now() };
    set((state) => ({
      entries: [entry, ...state.entries.filter((e) => !samePlace(e, entry))].slice(
        0,
        RECENT_ACTIVITY_LIMIT,
      ),
      revision: state.revision + 1,
    }));
  },
  seed: (places) =>
    set((state) => {
      const added = places.filter((p) => !state.entries.some((e) => samePlace(e, p)));
      if (added.length === 0) return state;
      return { entries: [...state.entries, ...added].slice(0, RECENT_ACTIVITY_LIMIT) };
    }),
  reset: () => set({ entries: [], revision: 0 }),
}));
