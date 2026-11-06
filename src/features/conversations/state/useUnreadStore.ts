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
  /** Spaces marked read here whose call to the server waits out its undo; their reads are held. */
  markAllPending: Record<string, true>;
  /** Clears a space's counts and holds later reads of them; returns what it cleared. */
  beginMarkAll: (spaceId: string) => CountSnapshot;
  /**
   * Ends a pending mark of a space.
   *
   * @param restore - What to put back, on top of what arrived in the meantime; left out when the
   *   mark stands.
   */
  endMarkAll: (spaceId: string, restore?: CountSnapshot) => void;
  /** Open conversations automatic marking must leave alone, until left or marked read. */
  held: Record<string, true>;
  setHeld: (conversationId: string) => void;
  clearHeld: (conversationId: string) => void;
  // Watermarks track the sentAt timestamp of the last seen message per conversation.
  // When a watermark exists, the MessageTimeline renders a "New messages" divider.
  watermarks: Record<string, string>;
  setWatermark: (conversationId: string, sentAt: string) => void;
  clearWatermark: (conversationId: string) => void;
}

type SpaceEntries = Pick<UnreadState, "counts" | "spaceOf" | "markers">;

/** A space's counts and read markers at one moment. */
export type CountSnapshot = Pick<UnreadState, "counts" | "markers">;

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
      const countSources: Record<string, CountSource> = {
        ...state.countSources,
        [spaceId]: markers ? "markers" : "plain",
      };
      if (state.markAllPending[spaceId]) return { countSources };
      const rest = withoutSpace(state, spaceId);
      for (const [conversationId, count] of Object.entries(counts)) {
        rest.counts[conversationId] = count;
        rest.spaceOf[conversationId] = spaceId;
        const marker = markers?.[conversationId];
        if (marker !== undefined) rest.markers[conversationId] = marker;
      }
      return { ...rest, countSources };
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
      if (!state.counts[conversationId] && !state.held[conversationId]) return state;
      const counts = { ...state.counts };
      const spaceOf = { ...state.spaceOf };
      const markers = { ...state.markers };
      const held = { ...state.held };
      delete counts[conversationId];
      delete spaceOf[conversationId];
      delete markers[conversationId];
      delete held[conversationId];
      return { counts, spaceOf, markers, held };
    }),
  markAllPending: {},
  beginMarkAll: (spaceId) => {
    const snapshot: CountSnapshot = { counts: {}, markers: {} };
    set((state) => {
      const held = { ...state.held };
      for (const [conversationId, count] of Object.entries(state.counts)) {
        if (state.spaceOf[conversationId] !== spaceId) continue;
        snapshot.counts[conversationId] = count;
        const marker = state.markers[conversationId];
        if (marker !== undefined) snapshot.markers[conversationId] = marker;
        delete held[conversationId];
      }
      return {
        ...withoutSpace(state, spaceId),
        held,
        markAllPending: { ...state.markAllPending, [spaceId]: true },
      };
    });
    return snapshot;
  },
  endMarkAll: (spaceId, restore) =>
    set((state) => {
      const markAllPending = { ...state.markAllPending };
      delete markAllPending[spaceId];
      if (!restore) return { markAllPending };
      const counts = { ...state.counts };
      const spaceOf = { ...state.spaceOf };
      const markers = { ...state.markers, ...restore.markers };
      for (const [conversationId, count] of Object.entries(restore.counts)) {
        counts[conversationId] = (counts[conversationId] ?? 0) + count;
        spaceOf[conversationId] = spaceId;
      }
      return { counts, spaceOf, markers, markAllPending };
    }),
  held: {},
  setHeld: (conversationId) =>
    set((state) => ({ held: { ...state.held, [conversationId]: true } })),
  clearHeld: (conversationId) =>
    set((state) => {
      if (!state.held[conversationId]) return state;
      const held = { ...state.held };
      delete held[conversationId];
      return { held };
    }),
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
