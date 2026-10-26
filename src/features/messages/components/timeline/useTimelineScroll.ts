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
}

/**
 * Virtualized scrolling for the message list (oldest at the top):
 * - only rows near the viewport are mounted; each is measured after render;
 * - first load lands on the newest message, or on the "New messages" divider;
 * - an appended message scrolls into view when the user was at the bottom or
 *   sent it themselves; otherwise the viewport stays put;
 * - when an older page is prepended the row that was first keeps its screen
 *   position (no jump), then the top sentinel can trigger the next page.
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
    paddingEnd: LIST_PADDING_Y,
    scrollPaddingEnd: HINT_BAR_CLEARANCE,
  });

  // When rows above the viewport are measured, keep the visible content still.
  // The default check compares each row's pre-batch start with an offset that
  // already includes earlier corrections from the same batch, so a batch of
  // shrinking rows (e.g. a freshly prepended page) under-corrects. Compare
  // against the offset from the last scroll event instead: both sides then
  // describe the same layout.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.start < (instance.scrollOffset ?? 0);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const atBottom = isScrolledToBottom(container);
    isAtBottomRef.current = atBottom;
    onScrollPosition?.(atBottom);
  }, [isAtBottomRef, onScrollPosition]);

  const scrollToIndex = useCallback(
    (index: number, align: "auto" | "center" = "auto") => {
      virtualizer.scrollToIndex(index, { align, behavior: "smooth" });
    },
    [virtualizer],
  );

  // Previous render's list edges and the container the initial scroll ran in.
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const initialScrollForRef = useRef<{ container: HTMLDivElement; listKey: string | null } | null>(
    null,
  );

  // Runs before paint so prepend compensation never shows a jumped frame.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const prevFirstId = prevFirstIdRef.current;
    const prevLastId = prevLastIdRef.current;
    prevFirstIdRef.current = items[0]?.id ?? null;
    prevLastIdRef.current = items[items.length - 1]?.id ?? null;
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
        return;
      }
    }

    const last = items[items.length - 1];
    if (last.id !== prevLastId) {
      const isOwnMessage = currentUserId !== undefined && last.authorId === currentUserId;
      if (isAtBottomRef.current || isOwnMessage) {
        virtualizer.scrollToEnd({ behavior: "smooth" });
      }
    }
  }, [listKey, items, firstNewIndex, currentUserId, virtualizer, isAtBottomRef]);

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
  };
}
