import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useUnreadStore } from "../../../conversations/state/useUnreadStore";
import { useMarkAsRead } from "../../../conversations/api/useMarkAsRead";
import { queryKeys } from "../../../../core/query/keys";
import { isAfter } from "../../../../shared/utils/timestamps";
import { isTimelineNotice } from "../../../e2ee/utils/timeline";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";
import type { MessagesPage } from "../../api/useMessages";
import { newestMessage } from "./useMarkSeen";

/** Older pages loaded on opening to reach the read marker, past the first page. */
export const MAX_EXTRA_PAGES_TO_MARKER = 3;

interface UseNewMessagesDividerOptions {
  workspaceId: string | null;
  conversationId: string | null;
  items: {
    sentAt: string;
    membershipNotice?: unknown;
    e2eeNotice?: unknown;
    authorId?: string;
    threadId?: string | null;
    isDeleted?: boolean;
  }[];
  currentUserId: string | undefined;
  isLensActive: boolean;
  /** Whether the user is currently at the bottom of the list (owned by the scroll hook). */
  isAtBottomRef: React.RefObject<boolean>;
  /** Whether the conversation's first page is still loading. */
  firstPagePending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/**
 * The "New messages" divider: which row it sits above, the 1s dwell-at-bottom dismissal with its
 * fade, and the watermark snapshot taken when the window is hidden.
 *
 * The line is the host's read marker while the conversation counts as unread, otherwise the local
 * watermark. Opening waits for the marker, no longer than the first page took to load, then for
 * older pages until everything the count says is unread is among the loaded messages, at most
 * {@link MAX_EXTRA_PAGES_TO_MARKER} of them. A marker in use is kept as the watermark, so the line
 * stays where it is once the conversation has been marked read.
 */
export function useNewMessagesDivider({
  workspaceId,
  conversationId,
  items,
  currentUserId,
  isLensActive,
  isAtBottomRef,
  firstPagePending,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: UseNewMessagesDividerOptions) {
  const qc = useQueryClient();
  const watermark = useUnreadStore((s) =>
    conversationId ? (s.watermarks[conversationId] ?? null) : null,
  );
  const count = useUnreadStore((s) => (conversationId ? (s.counts[conversationId] ?? 0) : 0));
  const storedMarker = useUnreadStore((s) =>
    conversationId ? (s.markers[conversationId] ?? null) : null,
  );
  const source = useUnreadStore((s) => (workspaceId ? s.countSources[workspaceId] : undefined));
  const clearWatermark = useUnreadStore((s) => s.clearWatermark);
  const markByHandSetting = useMessageDisplaySettingsStore((s) => s.markReadByHand);
  const { mutate: markAsRead } = useMarkAsRead();

  const held = useUnreadStore((s) => (conversationId ? Boolean(s.held[conversationId]) : false));

  const hasMarkers = source === "markers";
  const byHand = held || (markByHandSetting && hasMarkers);
  const marker = count > 0 ? storedMarker : null;
  const line = marker ?? watermark;

  // Index of the first new message (after the line). -1 means no divider.
  const firstNewIndex = useMemo(() => {
    if (!line || isLensActive || items.length === 0) return -1;
    return items.findIndex((m) => !m.membershipNotice && isAfter(m.sentAt, line));
  }, [line, isLensActive, items]);

  // Waiting for the marker: the counts have not answered, or a count that arrived live has none.
  const open = Boolean(workspaceId && conversationId) && !isLensActive;
  const markerMissing = open && hasMarkers && count > 0 && storedMarker === null;
  const markerAwaited = open && (source === undefined || markerMissing);
  const [gaveUpOn, setGaveUpOn] = useState<string | null>(null);
  const awaitingMarker = markerAwaited && gaveUpOn !== conversationId;

  const openedAtRef = useRef(0);
  useEffect(() => {
    openedAtRef.current = Date.now();
  }, [conversationId]);

  useEffect(() => {
    if (!awaitingMarker || firstPagePending) return;
    const timer = setTimeout(() => setGaveUpOn(conversationId), Date.now() - openedAtRef.current);
    return () => clearTimeout(timer);
  }, [awaitingMarker, firstPagePending, conversationId]);

  // A live count has no marker yet: the counts are read again once for this conversation.
  const refetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!markerMissing || !workspaceId || refetchedForRef.current === conversationId) return;
    refetchedForRef.current = conversationId;
    void qc.invalidateQueries({ queryKey: queryKeys.unreadCounts(workspaceId) });
  }, [markerMissing, workspaceId, conversationId, qc]);

  // What the loaded rows hold of what the store counts: top-level messages after the line, not
  // deleted, by someone else.
  const loadedUnread = useMemo(() => {
    if (marker === null) return 0;
    return items.filter(
      (m) =>
        !isTimelineNotice(m) &&
        !m.threadId &&
        !m.isDeleted &&
        m.authorId !== currentUserId &&
        isAfter(m.sentAt, marker),
    ).length;
  }, [items, marker, currentUserId]);

  // Row 0 is the first unread when nothing older remains to load, or when every unread message
  // the store counts is already among the loaded ones.
  const olderUnread = marker !== null && firstNewIndex === 0 && hasNextPage && loadedUnread < count;
  const [extraPages, setExtraPages] = useState({ conversationId, pages: 0 });
  const pagesLoaded = extraPages.conversationId === conversationId ? extraPages.pages : 0;
  const loadingOlder = olderUnread && pagesLoaded < MAX_EXTRA_PAGES_TO_MARKER;

  useEffect(() => {
    if (!loadingOlder || isFetchingNextPage) return;
    setExtraPages((previous) => ({
      conversationId,
      pages: previous.conversationId === conversationId ? previous.pages + 1 : 1,
    }));
    fetchNextPage();
  }, [loadingOlder, isFetchingNextPage, fetchNextPage, conversationId]);

  // The marker stays in place as the watermark once the conversation is marked read.
  useEffect(() => {
    if (!conversationId || !marker || marker === watermark) return;
    useUnreadStore.getState().setWatermark(conversationId, marker);
  }, [conversationId, marker, watermark]);

  // Marking by hand ends the line as soon as the conversation is read, wherever that was done.
  const previousCountRef = useRef({ conversationId, count });
  useEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = { conversationId, count };
    if (!byHand || !conversationId || previous.conversationId !== conversationId) return;
    if (previous.count > 0 && count === 0) clearWatermark(conversationId);
  }, [byHand, conversationId, count, clearWatermark]);

  const [dividerFading, setDividerFading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    dismissTimerRef.current = null;
    fadeTimerRef.current = null;
  }, []);

  /** Marks the conversation read up to the newest message shown, or does nothing without one. */
  const markUpToNewest = useCallback(() => {
    const newest = newestMessage(items, isLensActive);
    if (!conversationId || !workspaceId || !newest) return;
    markAsRead({ conversationId, workspaceId, readAt: newest.sentAt });
  }, [conversationId, workspaceId, items, isLensActive, markAsRead]);

  // Fade out, then mark the conversation read and clear the watermark.
  const dismissDivider = useCallback(() => {
    if (!conversationId || !workspaceId) return;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    const convId = conversationId;
    setDividerFading(true);
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      markUpToNewest();
      clearWatermark(convId);
      setDividerFading(false);
    }, 1000);
  }, [conversationId, workspaceId, markUpToNewest, clearWatermark]);

  /** The divider's own button, where reading does not mark: marks now and ends the line. */
  const markShownReadNow = useCallback(() => {
    if (!conversationId) return;
    markUpToNewest();
    clearWatermark(conversationId);
  }, [conversationId, markUpToNewest, clearWatermark]);

  /** Called on every scroll: dwelling 1s at the bottom dismisses the divider. */
  const onScrollPosition = useCallback(
    (atBottom: boolean) => {
      if (atBottom && firstNewIndex >= 0 && !byHand) {
        if (!dismissTimerRef.current) {
          dismissTimerRef.current = setTimeout(() => {
            dismissTimerRef.current = null;
            dismissDivider();
          }, 1000);
        }
      } else if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    },
    [firstNewIndex, byHand, dismissDivider],
  );

  // Divider gone: drop a pending dwell timer.
  useEffect(() => {
    if (firstNewIndex < 0 && dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [firstNewIndex]);

  // Marked unread during the dwell or the fade: the divider stays.
  useEffect(() => {
    if (!byHand) return;
    clearTimers();
    setDividerFading(false);
  }, [byHand, clearTimers]);

  // Conversation switch or unmount: cancel the previous conversation's timers.
  useEffect(() => {
    setDividerFading(false);
    return clearTimers;
  }, [conversationId, clearTimers]);

  // When the page hides while the user is at the bottom, snapshot a watermark
  // so messages arriving while away show the divider on return.
  useEffect(() => {
    if (!conversationId || !workspaceId) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (!isAtBottomRef.current) return;
      const cached = qc.getQueryData<{ pages: MessagesPage[] }>(
        queryKeys.messages(workspaceId, conversationId),
      );
      const newestPage = cached?.pages?.[0];
      const lastItem = newestPage?.items?.[newestPage.items.length - 1];
      if (lastItem?.sentAt) {
        useUnreadStore.getState().setWatermark(conversationId, lastItem.sentAt);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, workspaceId, qc, isAtBottomRef]);

  return {
    firstNewIndex,
    /** Whether the line is settled: the marker has answered, or the wait for it has ended. */
    firstNewKnown: !markerAwaited,
    /** Whether the list should keep showing its loading state rather than open. */
    awaitingFirstNew: awaitingMarker || loadingOlder,
    /** Whether unread messages older than the loaded ones remain. */
    moreAbove: olderUnread && !loadingOlder,
    dividerFading,
    /** The divider's "Mark as read", or null where reading marks by itself. */
    markShownRead: byHand ? markShownReadNow : null,
    onScrollPosition,
  };
}
