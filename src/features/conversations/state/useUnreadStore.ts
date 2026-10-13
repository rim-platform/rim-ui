import { create } from "zustand";

interface UnreadState {
  /** Unread messages by conversation id, across every space whose counts are loaded. */
  counts: Record<string, number>;
  /** The space of each conversation in `counts`. */
  spaceOf: Record<string, string>;
  /** Replace the counts of one space, leaving the other spaces' counts alone. */
  setCounts: (spaceId: string, counts: Record<string, number>) => void;
  increment: (conversationId: string, spaceId: string) => void;
  markRead: (conversationId: string) => void;
  /** Clear the counts of one space. */
  markAllRead: (spaceId: string) => void;
  // Watermarks track the sentAt timestamp of the last seen message per conversation.
  // When a watermark exists, the MessageTimeline renders a "New messages" divider.
  watermarks: Record<string, string>;
  setWatermark: (conversationId: string, sentAt: string) => void;
  clearWatermark: (conversationId: string) => void;
}

/** `counts` and `spaceOf` without the conversations of `spaceId`. */
function withoutSpace(
  counts: Record<string, number>,
  spaceOf: Record<string, string>,
  spaceId: string,
): { counts: Record<string, number>; spaceOf: Record<string, string> } {
  const nextCounts: Record<string, number> = {};
  const nextSpaceOf: Record<string, string> = {};
  for (const [conversationId, count] of Object.entries(counts)) {
    const space = spaceOf[conversationId];
    if (space === spaceId) continue;
    nextCounts[conversationId] = count;
    if (space !== undefined) nextSpaceOf[conversationId] = space;
  }
  return { counts: nextCounts, spaceOf: nextSpaceOf };
}

/** The unread messages of the conversations whose space `inSpace` accepts. */
export function unreadTotal(
  counts: Record<string, number>,
  spaceOf: Record<string, string>,
  inSpace: (spaceId: string) => boolean,
): number {
  let total = 0;
  for (const [conversationId, count] of Object.entries(counts)) {
    const space = spaceOf[conversationId];
    if (space !== undefined && inSpace(space)) total += count;
  }
  return total;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  counts: {},
  spaceOf: {},
  setCounts: (spaceId, counts) =>
    set((state) => {
      const rest = withoutSpace(state.counts, state.spaceOf, spaceId);
      for (const [conversationId, count] of Object.entries(counts)) {
        rest.counts[conversationId] = count;
        rest.spaceOf[conversationId] = spaceId;
      }
      return rest;
    }),
  increment: (conversationId, spaceId) =>
    set((state) => ({
      counts: {
        ...state.counts,
        [conversationId]: (state.counts[conversationId] ?? 0) + 1,
      },
      spaceOf: { ...state.spaceOf, [conversationId]: spaceId },
    })),
  markRead: (conversationId) =>
    set((state) => {
      if (!state.counts[conversationId]) return state;
      const counts = { ...state.counts };
      const spaceOf = { ...state.spaceOf };
      delete counts[conversationId];
      delete spaceOf[conversationId];
      return { counts, spaceOf };
    }),
  markAllRead: (spaceId) => set((state) => withoutSpace(state.counts, state.spaceOf, spaceId)),
  watermarks: {},
  setWatermark: (conversationId, sentAt) =>
    set((state) => ({
      watermarks: { ...state.watermarks, [conversationId]: sentAt },
    })),
  clearWatermark: (conversationId) =>
    set((state) => {
      const next = { ...state.watermarks };
      delete next[conversationId];
      return { watermarks: next };
    }),
}));
