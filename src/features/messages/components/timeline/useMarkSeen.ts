import { useCallback, useEffect, useMemo, useRef } from "react";

import { useMarkAsRead } from "../../../conversations/api/useMarkAsRead";
import { useUnreadStore } from "../../../conversations/state/useUnreadStore";

/** How long the viewer stays at the bottom before the server is told; also coalesces bursts. */
export const MARK_SEEN_DELAY_MS = 1000;

interface SeenItem {
  sentAt: string;
  authorId: string;
  e2eeNotice?: unknown;
}

interface UseMarkSeenOptions {
  workspaceId: string | null;
  conversationId: string | null;
  /** The loaded timeline, oldest first. */
  items: SeenItem[];
  isLensActive: boolean;
  currentUserId: string | undefined;
  /** Whether the viewer is at the bottom of the list (owned by the scroll hook). */
  isAtBottomRef: React.RefObject<boolean>;
}

interface SeenState {
  workspaceId: string | null;
  conversationId: string | null;
  items: SeenItem[];
  newest: SeenItem | null;
  unread: number;
  currentUserId: string | undefined;
}

/** The newest loaded message, or null when there is none or a lens hides the rest. */
function newestMessage(items: SeenItem[], isLensActive: boolean): SeenItem | null {
  if (isLensActive) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].e2eeNotice) return items[i];
  }
  return null;
}

function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}

/** Whether the store counts the conversation unread, or someone else wrote after `readUpTo`. */
function hasUnseen(state: SeenState, readUpTo: string | null): boolean {
  if (state.unread > 0) return true;
  if (readUpTo === null) return false;
  const readUpToMs = Date.parse(readUpTo);
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (Date.parse(item.sentAt) <= readUpToMs) return false;
    if (!item.e2eeNotice && item.authorId !== state.currentUserId) return true;
  }
  return false;
}

/**
 * Tells the server the open conversation is read once the viewer has seen its newest message:
 * the page is visible, the timeline is at the bottom, and the unread store, or a message from
 * someone else newer than what was last marked, says something is unread. The call waits
 * `MARK_SEEN_DELAY_MS` at the bottom (scrolling away or hiding the page cancels it, leaving the
 * conversation sends it at once) and marks up to the newest loaded message's `sentAt`, which
 * also clears the conversation's local count.
 */
export function useMarkSeen({
  workspaceId,
  conversationId,
  items,
  isLensActive,
  currentUserId,
  isAtBottomRef,
}: UseMarkSeenOptions) {
  const { mutate: markAsRead } = useMarkAsRead();
  const unread = useUnreadStore((s) => (conversationId ? (s.counts[conversationId] ?? 0) : 0));
  const newest = useMemo(() => newestMessage(items, isLensActive), [items, isLensActive]);

  const stateRef = useRef<SeenState>({
    workspaceId,
    conversationId,
    items,
    newest,
    unread,
    currentUserId,
  });
  // The `sentAt` of the active conversation's messages known to be read on the server.
  const readUpToRef = useRef<{ conversationId: string; sentAt: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readUpTo = useCallback((state: SeenState) => {
    const known = readUpToRef.current;
    return known && known.conversationId === state.conversationId ? known.sentAt : null;
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    cancel();
    const state = stateRef.current;
    const { workspaceId: wsId, conversationId: convId, newest: last } = state;
    if (!wsId || !convId || !last || !hasUnseen(state, readUpTo(state))) return;
    readUpToRef.current = { conversationId: convId, sentAt: last.sentAt };
    markAsRead({ conversationId: convId, workspaceId: wsId, readAt: last.sentAt });
  }, [cancel, markAsRead, readUpTo]);

  const scheduleIfUnseen = useCallback(() => {
    const state = stateRef.current;
    if (timerRef.current || !isPageVisible()) return;
    if (!state.newest || !hasUnseen(state, readUpTo(state))) return;
    timerRef.current = setTimeout(flush, MARK_SEEN_DELAY_MS);
  }, [flush, readUpTo]);

  // Runs before the effects below, and its value is still the previous render's in their cleanups.
  useEffect(() => {
    stateRef.current = { workspaceId, conversationId, items, newest, unread, currentUserId };
  });

  // Leaving the conversation (or unmounting) sends a pending mark at once.
  useEffect(
    () => () => {
      if (timerRef.current) flush();
    },
    [conversationId, flush],
  );

  // A newly opened conversation's newest loaded message is where reading starts from.
  useEffect(() => {
    if (!conversationId || !newest || readUpToRef.current?.conversationId === conversationId) {
      return;
    }
    readUpToRef.current = { conversationId, sentAt: newest.sentAt };
  }, [conversationId, newest]);

  // A newer message, or an unread count, while at the bottom.
  useEffect(() => {
    if (isAtBottomRef.current) scheduleIfUnseen();
  }, [conversationId, newest, unread, isAtBottomRef, scheduleIfUnseen]);

  // Nothing is seen while the page is hidden; coming back at the bottom counts.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isPageVisible()) cancel();
      else if (isAtBottomRef.current) scheduleIfUnseen();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAtBottomRef, scheduleIfUnseen, cancel]);

  /** Called on every scroll: reaching the bottom schedules the mark, leaving it cancels it. */
  const onScrollPosition = useCallback(
    (atBottom: boolean) => {
      if (atBottom) scheduleIfUnseen();
      else cancel();
    },
    [scheduleIfUnseen, cancel],
  );

  return { onScrollPosition };
}
