import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useEditMessageMutation } from "../../api/useEditMessage";
import { useToggleReactionMutation } from "../../api/useToggleReaction";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { toast } from "../../../../shared/toast";
import type { DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { useContextMenu } from "../../../../shared/ui/contextMenu/useContextMenu";
import type { MessageMenuTarget } from "../../hooks/useMessageContextMenu";
import type { MessageItemHandlers } from "../MessageItem";

/** What a timeline row knows of the message its context menu opens on. */
export type TimelineMenuTarget = Omit<MessageMenuTarget, "message">;

interface TimelineHandlerItem {
  id: string;
  text?: string | null;
  isDeleted?: boolean | null;
  isPinned?: boolean;
  threadId?: string | null;
  rootThreadId?: string | null;
  authorId: string;
}

interface UseTimelineHandlersOptions {
  items: TimelineHandlerItem[];
  workspaceId: string | null;
  conversationId: string | null;
  currentUserId: string | undefined;
  /** The context menu's items for a message, read when the menu opens. */
  getMenuItems: (target: TimelineMenuTarget) => DropdownMenuItem[];
}

/**
 * The row handlers for the timeline, as one referentially stable object:
 * every function is useCallback'd on values that only change with the
 * conversation, so MessageItem's memo holds across parent re-renders. `items`
 * and `getMenuItems` change with every render, so the context-menu handlers
 * read them through refs instead of closing over them.
 */
export function useTimelineHandlers({
  items,
  workspaceId,
  conversationId,
  currentUserId,
  getMenuItems,
}: UseTimelineHandlersOptions) {
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const setEditingMessageId = useShellStore((s) => s.setEditingMessageId);
  const { mutate: toggleReaction } = useToggleReactionMutation();
  const editMessage = useEditMessageMutation();
  const editMessageAsync = editMessage.mutateAsync;

  const { menu, bind, openFromEvent, openUnder, openAt } = useContextMenu();

  const itemsRef = useRef(items);
  const getMenuItemsRef = useRef(getMenuItems);
  useLayoutEffect(() => {
    itemsRef.current = items;
    getMenuItemsRef.current = getMenuItems;
  }, [items, getMenuItems]);

  const menuItemsFor = useCallback(
    (messageId: string, messageText: string) => () => {
      const msg = itemsRef.current.find((m) => m.id === messageId);
      return getMenuItemsRef.current({
        messageId,
        messageText,
        isOwnMessage: currentUserId !== undefined && msg?.authorId === currentUserId,
        isPinned: msg?.isPinned === true,
        hasThread: !!(msg?.threadId || msg?.rootThreadId),
      });
    },
    [currentUserId],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, messageId: string, messageText: string) => {
      openFromEvent(event, menuItemsFor(messageId, messageText));
    },
    [openFromEvent, menuItemsFor],
  );

  const bindContextMenu = useCallback(
    (messageId: string, messageText: string) => bind(menuItemsFor(messageId, messageText)),
    [bind, menuItemsFor],
  );

  /** Open a message's actions menu from the keyboard, under the message's row. */
  const openActionsFor = useCallback(
    (messageId: string) => {
      const msg = itemsRef.current.find((m) => m.id === messageId);
      if (!msg || msg.isDeleted) return;
      const row = Array.from(document.querySelectorAll("[data-message-id]")).find(
        (element) => element.getAttribute("data-message-id") === messageId,
      );
      const getItems = menuItemsFor(messageId, msg.text ?? "");
      if (row) openUnder(row, getItems);
      else openAt({ x: 16, y: 16 }, getItems);
    },
    [openUnder, openAt, menuItemsFor],
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

  const handleJumpToMessage = useCallback((messageId: string) => {
    if (itemsRef.current.some((m) => m.id === messageId)) {
      useShellStore.getState().setHighlightedMessageId(messageId);
    } else {
      toast.info("The original message is not loaded", {
        description: "Scroll up to load older messages.",
      });
    }
  }, []);

  const handlers = useMemo<MessageItemHandlers>(
    () => ({
      onOpenThread: openThread,
      onToggleReaction: handleToggleReaction,
      onContextMenu: handleContextMenu,
      bindContextMenu,
      onSaveEdit: handleSaveEdit,
      onCancelEdit: handleCancelEdit,
      onNavigateToForwardedSource: handleNavigateToForwardedSource,
      onJumpToMessage: handleJumpToMessage,
    }),
    [
      openThread,
      handleToggleReaction,
      handleContextMenu,
      bindContextMenu,
      handleSaveEdit,
      handleCancelEdit,
      handleNavigateToForwardedSource,
      handleJumpToMessage,
    ],
  );

  return {
    handlers,
    editError: editMessage.isError,
    /** The open context menu, to render once beside the list. */
    contextMenu: menu,
    openActionsFor,
  };
}
