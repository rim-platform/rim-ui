import { create } from "zustand";

/** What a space's last count read brought: `markers` from a host that lists the read marker. */
export type CountSource = "markers" | "plain";

interface UnreadState {
  /** Unread messages by conversation id, across every space whose counts are loaded. */
  counts: Record<string, number>;
  /** The space of each conversation in `counts`. */
  spaceOf: Record<string, string>;
  /** By conversation id, the time after which messages count as unread, as its host says. */
  markers: Record<string, string>;
  /** By space id, what the space's last count read brought; absent until one has answered. */
  countSources: Record<string, CountSource>;
  /**
   * Replace the counts of one space, leaving the other spaces' counts alone.
   *
   * @param markers - The space's read markers, from a host that has them; left out for one that
   *   has none.
   */
  setCounts: (
    spaceId: string,
    counts: Record<string, number>,
    markers?: Record<string, string>,
  ) => void;
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

type SpaceEntries = Pick<UnreadState, "counts" | "spaceOf" | "markers">;

/** `counts`, `spaceOf` and `markers` without the conversations of `spaceId`. */
function withoutSpace(entries: SpaceEntries, spaceId: string): SpaceEntries {
  const next: SpaceEntries = { counts: {}, spaceOf: {}, markers: {} };
  for (const [conversationId, count] of Object.entries(entries.counts)) {
    const space = entries.spaceOf[conversationId];
    if (space === spaceId) continue;
    next.counts[conversationId] = count;
    if (space !== undefined) next.spaceOf[conversationId] = space;
    const marker = entries.markers[conversationId];
    if (marker !== undefined) next.markers[conversationId] = marker;
  }
  return next;
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
  markers: {},
  countSources: {},
  setCounts: (spaceId, counts, markers) =>
    set((state) => {
      const rest = withoutSpace(state, spaceId);
      for (const [conversationId, count] of Object.entries(counts)) {
        rest.counts[conversationId] = count;
        rest.spaceOf[conversationId] = spaceId;
        const marker = markers?.[conversationId];
        if (marker !== undefined) rest.markers[conversationId] = marker;
      }
      return {
        ...rest,
        countSources: { ...state.countSources, [spaceId]: markers ? "markers" : "plain" },
      };
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
      const markers = { ...state.markers };
      delete counts[conversationId];
      delete spaceOf[conversationId];
      delete markers[conversationId];
      return { counts, spaceOf, markers };
    }),
  markAllRead: (spaceId) => set((state) => withoutSpace(state, spaceId)),
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
