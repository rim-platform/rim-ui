import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../../core/query/keys";
import { useMarkAsRead } from "../../../conversations/api/useMarkAsRead";
import { useUnreadStore } from "../../../conversations/state/useUnreadStore";
import { isTimelineNotice } from "../../../e2ee/utils/timeline";
import { isAfter } from "../../../../shared/utils/timestamps";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";

/** How long the viewer stays at the bottom before the server is told; also coalesces bursts. */
export const MARK_SEEN_DELAY_MS = 1000;

interface SeenItem {
  sentAt: string;
  authorId: string;
  e2eeNotice?: unknown;
  membershipNotice?: unknown;
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
export function newestMessage<T extends Parameters<typeof isTimelineNotice>[0]>(
  items: T[],
  isLensActive: boolean,
): T | null {
  if (isLensActive) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!isTimelineNotice(items[i])) return items[i];
  }
  return null;
}

/**
 * Whether a conversation is marked read only by hand: it was just marked unread and is still
 * open, or "Only when I mark it read" applies to its space, whose host then has read markers.
 */
export function marksByHand(spaceId: string, conversationId: string): boolean {
  const unread = useUnreadStore.getState();
  if (unread.held[conversationId]) return true;
  return (
    useMessageDisplaySettingsStore.getState().markReadByHand &&
    unread.countSources[spaceId] === "markers"
  );
}

function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}

/** Whether someone else wrote after `readUpTo`. */
function hasNewFromOthers(state: SeenState, readUpTo: string | null): boolean {
  if (readUpTo === null) return false;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (!isAfter(item.sentAt, readUpTo)) return false;
    if (!isTimelineNotice(item) && item.authorId !== state.currentUserId) return true;
  }
  return false;
}

/** Whether the store counts the conversation unread, or someone else wrote after `readUpTo`. */
function hasUnseen(state: SeenState, readUpTo: string | null): boolean {
  return state.unread > 0 || hasNewFromOthers(state, readUpTo);
}

/**
 * Tells the server the open conversation is read once the viewer has seen its newest message:
 * the page is visible, the timeline is at the bottom, and the unread store, or a message from
 * someone else newer than what was last marked, says something is unread. The call waits
 * `MARK_SEEN_DELAY_MS` at the bottom (scrolling away or hiding the page cancels it) and marks up
 * to the newest loaded message's `sentAt`, which also clears the conversation's local count.
 *
 * On a host with read markers, leaving the conversation cancels a pending mark, since reading
 * means having stayed, and reads the counts again when something arrived that was not marked. On
 * an older host, whose conversations have no marker to come back to, leaving sends it at once.
 * While a conversation just marked unread stays open, and with "Only when I mark it read" on such
 * a host, nothing is marked: a message arriving at the bottom reads the counts again instead, so
 * the conversation shows as unread.
 */
export function useMarkSeen({
  workspaceId,
  conversationId,
  items,
  isLensActive,
  currentUserId,
  isAtBottomRef,
}: UseMarkSeenOptions) {
  const qcRef = useRef(useQueryClient());
  const { mutate: markAsRead } = useMarkAsRead();
  const unread = useUnreadStore((s) => (conversationId ? (s.counts[conversationId] ?? 0) : 0));
  const held = useUnreadStore((s) => (conversationId ? Boolean(s.held[conversationId]) : false));
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
    if (marksByHand(wsId, convId)) {
      void qcRef.current.invalidateQueries({ queryKey: queryKeys.unreadCounts(wsId) });
      return;
    }
    markAsRead({ conversationId: convId, workspaceId: wsId, readAt: last.sentAt });
  }, [cancel, markAsRead, readUpTo]);

  const scheduleIfUnseen = useCallback(() => {
    const state = stateRef.current;
    if (timerRef.current || !isPageVisible() || !state.newest) return;
    const known = readUpTo(state);
    const due =
      state.workspaceId &&
      state.conversationId &&
      marksByHand(state.workspaceId, state.conversationId)
        ? hasNewFromOthers(state, known)
        : hasUnseen(state, known);
    if (!due) return;
    timerRef.current = setTimeout(flush, MARK_SEEN_DELAY_MS);
  }, [flush, readUpTo]);

  // Runs before the effects below, and its value is still the previous render's in their cleanups.
  useEffect(() => {
    stateRef.current = { workspaceId, conversationId, items, newest, unread, currentUserId };
  });

  // Leaving the conversation (or unmounting): see the hook's description.
  useEffect(
    () => () => {
      const state = stateRef.current;
      const space = state.workspaceId;
      if (space && useUnreadStore.getState().countSources[space] === "markers") {
        cancel();
        if (hasNewFromOthers(state, readUpTo(state))) {
          void qcRef.current.invalidateQueries({ queryKey: queryKeys.unreadCounts(space) });
        }
      } else if (timerRef.current) {
        flush();
      }
    },
    [conversationId, cancel, flush, readUpTo],
  );

  // A newly opened conversation's newest loaded message is where reading starts from.
  useEffect(() => {
    if (!conversationId || !newest || readUpToRef.current?.conversationId === conversationId) {
      return;
    }
    readUpToRef.current = { conversationId, sentAt: newest.sentAt };
  }, [conversationId, newest]);

  // A hold takes back a mark that was about to go out.
  useEffect(() => {
    if (held) cancel();
  }, [held, cancel]);

  // A newer message, or an unread count, while at the bottom.
  useEffect(() => {
    if (isAtBottomRef.current) scheduleIfUnseen();
  }, [conversationId, newest, unread, held, isAtBottomRef, scheduleIfUnseen]);

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
