import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useEditMessageMutation } from "../../api/useEditMessage";
import { useToggleReactionMutation } from "../../api/useToggleReaction";
import { useShellStore } from "../../../../shell/state/useShellStore";
import type { MessageItemHandlers } from "../MessageItem";

export interface TimelineContextMenu {
  x: number;
  y: number;
  messageId: string;
  messageText: string;
  isOwnMessage: boolean;
  isPinned: boolean;
  hasThread: boolean;
}

interface TimelineHandlerItem {
  id: string;
  isPinned?: boolean;
  threadId?: string | null;
  rootThreadId?: string | null;
  author?: { id: string } | null;
}

interface UseTimelineHandlersOptions {
  items: TimelineHandlerItem[];
  workspaceId: string | null;
  conversationId: string | null;
  currentUserId: string | undefined;
}

/**
 * The row handlers for the timeline, as one referentially stable object:
 * every function is useCallback'd on values that only change with the
 * conversation, so MessageItem's memo holds across parent re-renders. `items`
 * changes with every new message, so the context-menu handler reads it
 * through a ref instead of closing over it.
 */
export function useTimelineHandlers({
  items,
  workspaceId,
  conversationId,
  currentUserId,
}: UseTimelineHandlersOptions) {
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const setEditingMessageId = useShellStore((s) => s.setEditingMessageId);
  const { mutate: toggleReaction } = useToggleReactionMutation();
  const editMessage = useEditMessageMutation();
  const editMessageAsync = editMessage.mutateAsync;

  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null);

  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, messageId: string, messageText: string) => {
      const msg = itemsRef.current.find((m) => m.id === messageId);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        messageId,
        messageText,
        isOwnMessage: msg?.author?.id === currentUserId,
        isPinned: msg?.isPinned === true,
        hasThread: !!(msg?.threadId || msg?.rootThreadId),
      });
    },
    [currentUserId],
  );

  const handleSaveEdit = useCallback(
    async (messageId: string, newText: string) => {
      if (!workspaceId || !conversationId) return;
      try {
        await editMessageAsync({
          serverId: workspaceId,
          conversationId,
          messageId,
          text: newText,
        });
        setEditingMessageId(null);
      } catch {
        // Keep edit mode open — user can retry or cancel
      }
    },
    [workspaceId, conversationId, editMessageAsync, setEditingMessageId],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, [setEditingMessageId]);

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!workspaceId || !conversationId) return;
      toggleReaction({ serverId: workspaceId, conversationId, messageId, emoji });
    },
    [workspaceId, conversationId, toggleReaction],
  );

  const handleNavigateToForwardedSource = useCallback(
    (targetConversationId: string, targetMessageId: string) => {
      const shell = useShellStore.getState();
      shell.setSelectedConversationId(targetConversationId);
      shell.setHighlightedMessageId(targetMessageId);
    },
    [],
  );

  const handlers = useMemo<MessageItemHandlers>(
    () => ({
      onOpenThread: openThread,
      onToggleReaction: handleToggleReaction,
      onContextMenu: handleContextMenu,
      onSaveEdit: handleSaveEdit,
      onCancelEdit: handleCancelEdit,
      onNavigateToForwardedSource: handleNavigateToForwardedSource,
    }),
    [
      openThread,
      handleToggleReaction,
      handleContextMenu,
      handleSaveEdit,
      handleCancelEdit,
      handleNavigateToForwardedSource,
    ],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return { handlers, editError: editMessage.isError, contextMenu, closeContextMenu };
}
