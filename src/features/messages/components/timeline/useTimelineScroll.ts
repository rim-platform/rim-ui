import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range } from "@tanstack/react-virtual";

import type { DisplayDensity } from "../../../../shell/state/useShellStore";

/** Initial row-height guesses per density; rows are measured once rendered. */
const ESTIMATED_ROW_HEIGHT: Record<DisplayDensity, number> = {
  comfortable: 64,
  compact: 40,
  "ultra-compact": 28,
};

/** Vertical padding of the list. */
export const LIST_PADDING_Y = 12;
const AT_BOTTOM_THRESHOLD = 50;
/** Room scrollToIndex keeps below a row for the NAVIGATE hint bar floating over the list's bottom. */
const HINT_BAR_CLEARANCE = 36;

/** Whether `container` is scrolled to (within a few pixels of) its end. */
function isScrolledToBottom(container: HTMLElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight < AT_BOTTOM_THRESHOLD
  );
}

/**
 * The height of the rows that left the list and lay wholly above `offset` in its previous layout,
 * or null when the first row visible then has left too (a lens or another list, nothing to keep).
 *
 * @param prevIds - The previous rows' ids, in order.
 * @param present - The ids still in the list.
 * @param sizeOf - A row's height as the previous layout had it.
 * @param start - Where the first row started (the list's top padding).
 * @param offset - The scroll offset before this change.
 */
function heightRemovedAbove(
  prevIds: string[],
  present: Set<string>,
  sizeOf: (id: string) => number,
  start: number,
  offset: number,
): number | null {
  let removed = 0;
  for (const id of prevIds) {
    const size = sizeOf(id);
    if (start + size > offset) return present.has(id) ? removed : null;
    if (!present.has(id)) removed += size;
    start += size;
  }
  return removed;
}

interface TimelineScrollItem {
  id: string;
  authorId: string;
}

interface UseTimelineScrollOptions {
  /** Identifies the list being shown (the conversation); a change means "fresh list". */
  listKey: string | null;
  items: TimelineScrollItem[];
  currentUserId: string | undefined;
  displayDensity: DisplayDensity;
  /** Row to show at the top on first load (the "New messages" divider), or -1. */
  firstNewIndex: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  onScrollPosition?: (atBottom: boolean) => void;
  /** Shared with the divider hook; kept current by scroll events. */
  isAtBottomRef: React.RefObject<boolean>;
  /**
   * A row kept mounted even when scrolled out of view (the message being
   * edited), so its unsaved draft and focus survive scrolling away.
   */
  pinnedIndex: number;
  /**
   * Whether the NAVIGATE hint bar floats over the list's bottom; the list then ends with room for
   * it under the newest row.
   */
  hintBarShown: boolean;
  /**
   * Set while a pointer press on the list is held; the list then keeps its scroll position, so
   * the press, its click and its context menu land on the row under the pointer.
   */
  pointerPressRef: React.RefObject<string | null>;
}

/**
 * Virtualized scrolling for the message list (oldest at the top):
 * - only rows near the viewport are mounted; each is measured after render;
 * - first load lands on the newest message, or on the "New messages" divider;
 * - an appended message scrolls into view when the list follows its end or the
 *   user sent it themselves; otherwise the viewport stays put. The list follows
 *   its end from when it reaches it or starts a scroll to it until a scroll
 *   moves it back toward the start away from the end;
 * - when an older page is prepended the row that was first keeps its screen
 *   position (no jump), then the top sentinel can trigger the next page;
 * - rows that leave the list above the viewport keep the first visible row in place.
 *
 * A fresh list (new `listKey`, or a remounted scroll container after a
 * loading state) is told apart from a prepend or an append by remembering
 * which list and container the initial scroll ran for.
 */
export function useTimelineScroll({
  listKey,
  items,
  currentUserId,
  displayDensity,
  firstNewIndex,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onScrollPosition,
  isAtBottomRef,
  pinnedIndex,
  hintBarShown,
  pointerPressRef,
}: UseTimelineScrollOptions) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  const getItemKey = useCallback((index: number) => items[index]?.id ?? index, [items]);
  const estimateSize = useCallback(() => ESTIMATED_ROW_HEIGHT[displayDensity], [displayDensity]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (pinnedIndex < 0 || pinnedIndex >= range.count || indexes.includes(pinnedIndex)) {
        return indexes;
      }
      return [...indexes, pinnedIndex].sort((a, b) => a - b);
    },
    [pinnedIndex],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    getItemKey,
    rangeExtractor,
    overscan: 8,
    paddingStart: LIST_PADDING_Y,
    paddingEnd: LIST_PADDING_Y + (hintBarShown ? HINT_BAR_CLEARANCE : 0),
    scrollPaddingEnd: HINT_BAR_CLEARANCE,
  });

  // Whether the list follows its end. Unlike `isAtBottomRef`, which a scroll event can read
  // away from the end while a scroll to the end is still on its way, it changes only when the
  // list reaches its end, when this hook starts a scroll to it, or when a scroll moves the list
  // toward its start away from the end (a wheel, touch, key or scrollbar, or a scroll to a row).
  const followEndRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  // The scroll corrections the virtualizer makes for measured rows since the last scroll event,
  // so that handleScroll does not take a correction toward the start for the user scrolling away.
  const pendingCorrectionRef = useRef(0);
  // The row whose text is unfolding: its next size change keeps its top where it is.
  const foldExpandIdRef = useRef<string | null>(null);

  const scrollToEnd = useCallback(
    (behavior: "auto" | "smooth" = "auto") => {
      followEndRef.current = true;
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer],
  );

  // When rows above the viewport are measured, keep the visible content still.
  // The default check compares each row's pre-batch start with an offset that
  // already includes earlier corrections from the same batch, so a batch of
  // shrinking rows (e.g. a freshly prepended page) under-corrects. Compare
  // against the offset from the last scroll event instead: both sides then
  // describe the same layout. A row that changes size while the list follows its
  // end keeps the end in view, unless a pointer press is held on the list. A row whose text
  // unfolds grows downward from where it is.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    if (item.key === foldExpandIdRef.current) {
      foldExpandIdRef.current = null;
      return false;
    }
    const adjust =
      item.start < (instance.scrollOffset ?? 0) ||
      (followEndRef.current && pointerPressRef.current === null);
    if (adjust) pendingCorrectionRef.current += delta;
    return adjust;
  };

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const atBottom = isScrolledToBottom(container);
    const scrollTop = container.scrollTop;
    // Where the list would be had only the virtualizer's corrections moved it; a pixel of slack
    // absorbs fractional row heights.
    const expected = lastScrollTopRef.current + pendingCorrectionRef.current - 1;
    pendingCorrectionRef.current = 0;
    if (atBottom) followEndRef.current = true;
    else if (scrollTop < expected) followEndRef.current = false;
    lastScrollTopRef.current = scrollTop;
    isAtBottomRef.current = atBottom;
    onScrollPosition?.(atBottom);
  }, [isAtBottomRef, onScrollPosition]);

  /** Before a row's text unfolds: keep that row's top still and stop following the end. */
  const onFoldToggle = useCallback((messageId: string, expanding: boolean) => {
    if (!expanding) return;
    foldExpandIdRef.current = messageId;
    followEndRef.current = false;
  }, []);

  const scrollToIndex = useCallback(
    (index: number, align: "auto" | "center" = "auto") => {
      virtualizer.scrollToIndex(index, { align, behavior: "smooth" });
    },
    [virtualizer],
  );

  // Previous render's row ids and the container the initial scroll ran in.
  const prevIdsRef = useRef<string[]>([]);
  const initialScrollForRef = useRef<{ container: HTMLDivElement; listKey: string | null } | null>(
    null,
  );

  // Runs before paint so prepend compensation never shows a jumped frame.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const prevIds = prevIdsRef.current;
    prevIdsRef.current = items.map((m) => m.id);
    const prevFirstId = prevIds[0] ?? null;
    const prevLastId = prevIds[prevIds.length - 1] ?? null;
    if (!container || items.length === 0) return;

    const initialFor = initialScrollForRef.current;
    if (initialFor?.container !== container || initialFor.listKey !== listKey) {
      initialScrollForRef.current = { container, listKey };
      if (firstNewIndex >= 0) {
        virtualizer.scrollToIndex(firstNewIndex, { align: "start" });
      } else {
        virtualizer.scrollToEnd();
      }
      // A list that fits needs no scroll, so no scroll event would replace the previous list's value.
      isAtBottomRef.current = isScrolledToBottom(container);
      followEndRef.current = firstNewIndex < 0 || isAtBottomRef.current;
      lastScrollTopRef.current = container.scrollTop;
      return;
    }

    // Older page prepended: shift by the height added above the old first row.
    if (prevFirstId !== null && items[0].id !== prevFirstId) {
      const anchorIndex = items.findIndex((m) => m.id === prevFirstId);
      if (anchorIndex > 0) {
        // getTotalSize() refreshes measurementsCache with sizes measured this commit.
        virtualizer.getTotalSize();
        const measurements = virtualizer.measurementsCache;
        const added = measurements[anchorIndex].start - measurements[0].start;
        // The virtualizer's offset is the pre-commit position; resize corrections
        // applied during this commit are already included in `added`.
        container.scrollTop = (virtualizer.scrollOffset ?? container.scrollTop) + added;
        followEndRef.current = isScrolledToBottom(container);
        return;
      }
    }

    // Rows gone from above the viewport (a refetch that slides the loaded window, a deleted
    // message): the first visible row keeps its place on screen, or the end stays in view.
    const present = new Set(items.map((m) => m.id));
    if (prevIds.some((id) => !present.has(id))) {
      const offset = virtualizer.scrollOffset ?? container.scrollTop;
      const removed = heightRemovedAbove(
        prevIds,
        present,
        (id) => virtualizer.itemSizeCache.get(id) ?? ESTIMATED_ROW_HEIGHT[displayDensity],
        LIST_PADDING_Y,
        offset,
      );
      if (followEndRef.current && pointerPressRef.current === null) scrollToEnd();
      else if (removed) container.scrollTop = offset - removed;
    }

    const last = items[items.length - 1];
    if (last.id !== prevLastId) {
      const isOwnMessage = currentUserId !== undefined && last.authorId === currentUserId;
      if (followEndRef.current || isOwnMessage) scrollToEnd("smooth");
    }
  }, [
    listKey,
    items,
    firstNewIndex,
    currentUserId,
    displayDensity,
    virtualizer,
    isAtBottomRef,
    pointerPressRef,
    scrollToEnd,
  ]);

  // A list that follows its end stays at its end when room for the hint bar appears or goes, or
  // when its rows grow (an image arrives), but not while a pointer press is held on it: moving
  // the rows then would send the press's click or context menu to another row.
  const prevHintBarRef = useRef(hintBarShown);
  useLayoutEffect(() => {
    if (prevHintBarRef.current === hintBarShown) return;
    prevHintBarRef.current = hintBarShown;
    if (followEndRef.current && pointerPressRef.current === null) scrollToEnd();
  }, [hintBarShown, pointerPressRef, scrollToEnd]);

  const totalSize = virtualizer.getTotalSize();
  const firstItemId = items[0]?.id;
  const prevSizeRef = useRef({ totalSize, firstItemId });
  useLayoutEffect(() => {
    const prev = prevSizeRef.current;
    prevSizeRef.current = { totalSize, firstItemId };
    // A prepended page grows the list above the viewport; the prepend logic keeps its place.
    const prepended =
      firstItemId !== prev.firstItemId && items.some((m) => m.id === prev.firstItemId);
    if (totalSize <= prev.totalSize || prepended) return;
    if (followEndRef.current && pointerPressRef.current === null) scrollToEnd();
  }, [totalSize, firstItemId, items, pointerPressRef, scrollToEnd]);

  // Top sentinel visible -> load the next (older) page. Re-observed when the
  // first row changes, which also covers the per-conversation remount.
  const firstId = items[0]?.id ?? null;
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || firstId === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [firstId, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    virtualizer,
    scrollContainerRef,
    topSentinelRef,
    handleScroll,
    scrollToIndex,
    onFoldToggle,
  };
}
