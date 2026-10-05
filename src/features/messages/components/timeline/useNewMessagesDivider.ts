import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useUnreadStore } from "../../../conversations/state/useUnreadStore";
import { useMarkAsRead } from "../../../conversations/api/useMarkAsRead";
import { queryKeys } from "../../../../core/query/keys";
import type { MessagesPage } from "../../api/useMessages";

interface UseNewMessagesDividerOptions {
  workspaceId: string | null;
  conversationId: string | null;
  items: { sentAt: string }[];
  isLensActive: boolean;
  /** Whether the user is currently at the bottom of the list (owned by the scroll hook). */
  isAtBottomRef: React.RefObject<boolean>;
}

/**
 * The "New messages" divider: which row it sits above (from the unread
 * watermark), the 1s dwell-at-bottom dismissal with its fade, and the
 * watermark snapshot taken when the window is hidden.
 */
export function useNewMessagesDivider({
  workspaceId,
  conversationId,
  items,
  isLensActive,
  isAtBottomRef,
}: UseNewMessagesDividerOptions) {
  const qc = useQueryClient();
  const watermark = useUnreadStore((s) =>
    conversationId ? (s.watermarks[conversationId] ?? null) : null,
  );
  const clearWatermark = useUnreadStore((s) => s.clearWatermark);
  const { mutate: markAsRead } = useMarkAsRead();

  // Index of the first new message (after watermark). -1 means no divider.
  const firstNewIndex = useMemo(() => {
    if (!watermark || isLensActive || items.length === 0) return -1;
    return items.findIndex((m) => m.sentAt > watermark);
  }, [watermark, isLensActive, items]);

  const [dividerFading, setDividerFading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    dismissTimerRef.current = null;
    fadeTimerRef.current = null;
  }, []);

  // Fade out, then mark the conversation read and clear the watermark.
  const dismissDivider = useCallback(() => {
    if (!conversationId || !workspaceId) return;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    const convId = conversationId;
    const wsId = workspaceId;
    setDividerFading(true);
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      markAsRead({ conversationId: convId, workspaceId: wsId, readAt: new Date().toISOString() });
      clearWatermark(convId);
      setDividerFading(false);
    }, 1000);
  }, [conversationId, workspaceId, markAsRead, clearWatermark]);

  /** Called on every scroll: dwelling 1s at the bottom dismisses the divider. */
  const onScrollPosition = useCallback(
    (atBottom: boolean) => {
      if (atBottom && firstNewIndex >= 0) {
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
    [firstNewIndex, dismissDivider],
  );

  // Divider gone: drop a pending dwell timer.
  useEffect(() => {
    if (firstNewIndex < 0 && dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [firstNewIndex]);

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

  return { firstNewIndex, dividerFading, onScrollPosition };
}
