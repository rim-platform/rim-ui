import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShellStore } from "../../../shell/state/useShellStore";
import { runPinCommand } from "../api/messageCommands";
import { toast } from "../../../shared/toast";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import { vimModeEnabled } from "../../commands/state/useKeybindProfileStore";
import { useMessageFoldStore } from "../state/useMessageFoldStore";
import {
  useSelectedMessageStore,
  type MessageSelectionTarget,
} from "../state/useSelectedMessageStore";

interface MessageNavItem {
  id: string;
  text?: string | null;
  isPinned?: boolean;
  authorId: string;
  rootThreadId?: string | null;
}

interface UseMessageNavigationOptions {
  items: MessageNavItem[];
  conversationId: string | null;
  workspaceId: string | null;
  currentUserId: string | undefined;
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;
  openThread: (messageId: string) => void;
  onDeleteMessage: (msg: { id: string }) => void | Promise<void>;
  onForwardMessage: (msg: { id: string; text: string }) => void;
  /** Starts a timeline reply to a message; absent where the viewer cannot post. */
  onReply?: (messageId: string) => void;
  /** Whether `t` may start a thread on a message without one. Defaults to true. */
  canStartThread?: boolean;
  /** Whether `p` may pin or unpin. Defaults to true. */
  canPin?: boolean;
  /** Open the actions menu of a message, as a right click on it does. */
  onOpenActions?: (messageId: string) => void;
  /** Called before `o` unfolds (`expanding`) or folds a message's text again. */
  onFoldToggle?: (messageId: string, expanding: boolean) => void;
  /** Index of the first new message after the watermark, or -1 if no divider. */
  firstNewIndex?: number;
  /**
   * Bring a row into view. The list is virtualized, so the selected row may
   * not be mounted; the caller scrolls by index rather than by DOM node.
   */
  scrollToIndex: (index: number) => void;
  /**
   * The message a pointer press on the list landed on (`""` for none) while that press gives the
   * list focus; entering NAVIGATE then keeps the selection the press made, or selects the newest
   * message when nothing is selected, without scrolling.
   */
  pointerEntryRef: React.RefObject<string | null>;
}

const ROW_CONTROL = "button, a[href], video, audio, [role='button']";

/** True when `target` is an interactive element inside the list rather than the list itself. */
function isRowControl(target: HTMLElement, list: EventTarget): boolean {
  return target !== list && target.closest(ROW_CONTROL) !== null;
}

export function useMessageNavigation({
  items,
  conversationId,
  workspaceId,
  currentUserId,
  editingMessageId,
  setEditingMessageId,
  openThread,
  onDeleteMessage,
  onForwardMessage,
  onReply,
  canStartThread = true,
  canPin = true,
  onOpenActions,
  onFoldToggle,
  firstNewIndex = -1,
  scrollToIndex,
  pointerEntryRef,
}: UseMessageNavigationOptions) {
  // Selection is tracked by message id so it stays on the same message when older pages are
  // prepended (which shifts every index). It lives in the shared store, so commands run from
  // keybinds and other surfaces act on the same message.
  const selectedMessageId = useSelectedMessageStore((s) =>
    s.selection &&
    s.selection.workspaceId === workspaceId &&
    s.selection.conversationId === conversationId
      ? s.selection.messageId
      : null,
  );
  const setSelectedMessageId = useCallback(
    (messageId: string | null) => {
      if (!conversationId) return;
      const store = useSelectedMessageStore.getState();
      if (messageId === null || !workspaceId) store.clear(conversationId);
      else store.select({ workspaceId, conversationId, messageId });
    },
    [workspaceId, conversationId],
  );
  const selectedMessageIndex = useMemo(
    () => (selectedMessageId ? items.findIndex((m) => m.id === selectedMessageId) : -1),
    [items, selectedMessageId],
  );
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  /** Select a row and scroll it into view. */
  const selectIndex = useCallback(
    (index: number) => {
      const msg = items[index];
      if (!msg) return;
      setSelectedMessageId(msg.id);
      scrollToIndex(index);
    },
    [items, scrollToIndex, setSelectedMessageId],
  );

  // Reset the pending delete when the conversation changes, while rendering it, and the
  // editing state and the delete timer once it is shown. The selection of a conversation is
  // dropped when the list leaves it or unmounts.
  const [selectionConversationId, setSelectionConversationId] = useState(conversationId);
  if (selectionConversationId !== conversationId) {
    setSelectionConversationId(conversationId);
    setDeleteConfirmMessageId(null);
  }
  useEffect(() => {
    if (!conversationId) return;
    return () => useSelectedMessageStore.getState().clear(conversationId);
  }, [conversationId]);
  useEffect(() => {
    setEditingMessageId(null);
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
    }
  }, [conversationId, setEditingMessageId]);

  /** Selects the message a pointer press landed on, without scrolling. */
  const selectPressedMessage = useCallback(
    (messageId: string) => {
      if (!items.some((m) => m.id === messageId)) return;
      setSelectedMessageId(messageId);
      setDeleteConfirmMessageId(null);
    },
    [items, setSelectedMessageId],
  );

  // Select the newest message when entering navigation mode with nothing selected; a pointer
  // entry does not scroll, and a message already selected, by the press or before, stays.
  useEffect(() => {
    const unsub = useShellStore.subscribe((state, prev) => {
      if (state.navigationMode && !prev.navigationMode) {
        if (selectedMessageIndex === -1 && items.length > 0) {
          const pressed = pointerEntryRef.current;
          if (pressed === null) selectIndex(items.length - 1);
          // A press on a message selects it itself; one on empty list space takes the newest.
          else if (pressed === "") setSelectedMessageId(items[items.length - 1].id);
        }
      }
    });
    return unsub;
  }, [selectedMessageIndex, items, selectIndex, setSelectedMessageId, pointerEntryRef]);

  // Clean up delete confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
      }
    };
  }, []);

  /** Moves the selection as the list's navigation keys do; `false` when the list is empty. */
  const moveSelection = useCallback(
    (target: MessageSelectionTarget): boolean => {
      if (items.length === 0) return false;
      setDeleteConfirmMessageId(null);
      if (target === "first") selectIndex(0);
      else if (target === "last") selectIndex(items.length - 1);
      else if (target === "next") selectIndex(Math.min(selectedMessageIndex + 1, items.length - 1));
      else selectIndex(selectedMessageIndex <= 0 ? 0 : selectedMessageIndex - 1);
      return true;
    },
    [items, selectedMessageIndex, selectIndex],
  );

  /** Shows more or less of a message whose tall text folds; `false` when it does not fold. */
  const toggleFold = useCallback(
    (messageId: string): boolean => {
      const fold = useMessageFoldStore.getState();
      if (messageId === editingMessageId || !fold.foldable.has(messageId)) return false;
      onFoldToggle?.(messageId, !fold.expanded.has(messageId));
      fold.toggleExpanded(messageId);
      return true;
    },
    [editingMessageId, onFoldToggle],
  );

  const handleMessageListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skip when a text input is focused (e.g. message edit textarea)
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable) {
        return;
      }
      // Enter and Space belong to a focused control inside a row (copy, embed, quote, mention).
      if ((e.key === "Enter" || e.key === " ") && isRowControl(target, e.currentTarget)) {
        return;
      }

      const navMode = useShellStore.getState().navigationMode;

      // Escape always works: exit navigation mode and return to composer. With the Vim layer
      // on, the list is normal mode already, so Escape only drops the selection.
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedMessageId(null);
        setDeleteConfirmMessageId(null);
        if (vimModeEnabled()) return;
        useShellStore.getState().setNavigationMode(false);
        document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
        return;
      }

      // The timeline's keys are plain keys: with Ctrl, Alt or Meta the key belongs to the browser
      // or to keybinds (Ctrl+C copies the selected text).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // All other keys require navigation mode to be active
      if (!navMode) return;

      // i or Enter: exit navigation mode, focus composer (vim "insert mode")
      if (e.key === "i" || e.key === "Enter") {
        e.preventDefault();
        useShellStore.getState().setNavigationMode(false);
        document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
        return;
      }
      if (items.length === 0) return;

      // Shift+N: jump selection to first message after the "New messages" divider
      if (e.key === "N" && e.shiftKey) {
        if (firstNewIndex >= 0 && firstNewIndex < items.length) {
          e.preventDefault();
          selectIndex(firstNewIndex);
        }
        return;
      }

      // Home and End: first and last message
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        moveSelection(e.key === "Home" ? "first" : "last");
        return;
      }

      // Navigation: j/k and ArrowDown/ArrowUp
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        moveSelection("next");
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        moveSelection("previous");
        return;
      }

      // Actions on selected message
      if (selectedMessageIndex < 0) return;
      const msg = items[selectedMessageIndex];
      if (!msg) return;
      const isOwnMessage = currentUserId !== undefined && msg.authorId === currentUserId;

      // The context-menu key or Shift+F10: the message's actions menu, as a right click opens.
      // A link or an attachment inside the row that opened its own menu has taken the key.
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        if (onOpenActions && !e.defaultPrevented) {
          e.preventDefault();
          onOpenActions(msg.id);
        }
        return;
      }

      // If in delete-confirm mode, any key other than d cancels
      if (deleteConfirmMessageId) {
        if (e.key === "d") {
          e.preventDefault();
          if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
          setDeleteConfirmMessageId(null);
          void onDeleteMessage(msg);
        } else {
          // Cancel delete confirmation
          if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
          setDeleteConfirmMessageId(null);
        }
        return;
      }

      switch (e.key) {
        // r starts a reply quoted above the composer; t opens the message's thread.
        case "r": {
          if (!onReply) break;
          e.preventDefault();
          onReply(msg.id);
          break;
        }
        case "t": {
          if (!canStartThread && !msg.rootThreadId) break;
          e.preventDefault();
          openThread(msg.id);
          break;
        }
        case "e": {
          if (editingMessageId) return;
          if (isOwnMessage) {
            e.preventDefault();
            setEditingMessageId(msg.id);
          }
          break;
        }
        case "p": {
          if (!canPin) break;
          e.preventDefault();
          if (!workspaceId || !conversationId) break;
          // The list key runs the pin or unpin command on the selected message.
          void runPinCommand(
            { workspaceId, conversationId, selectedMessageId: msg.id },
            !msg.isPinned,
            {
              source: "key",
              successToast: msg.isPinned ? "Message unpinned" : "Message pinned",
            },
          );
          break;
        }
        case "d": {
          if (!isOwnMessage) break;
          e.preventDefault();
          // Arm delete confirmation
          setDeleteConfirmMessageId(msg.id);
          if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
          deleteConfirmTimerRef.current = setTimeout(() => {
            setDeleteConfirmMessageId(null);
          }, 2000);
          break;
        }
        case "c": {
          e.preventDefault();
          if (msg.text) {
            navigator.clipboard.writeText(msg.text);
            toast.success("Copied to clipboard");
          }
          break;
        }
        case "f": {
          e.preventDefault();
          onForwardMessage({ id: msg.id, text: msg.text ?? "" });
          break;
        }
        // o shows more or less of a message whose tall text folds.
        case "o": {
          if (toggleFold(msg.id)) e.preventDefault();
          break;
        }
        case "/": {
          e.preventDefault();
          useSearchOverlayStore
            .getState()
            .openWithScope(
              conversationId ? { kind: "conversation", conversationId } : { kind: "all" },
            );
          break;
        }
      }
    },
    [
      items,
      selectedMessageIndex,
      deleteConfirmMessageId,
      currentUserId,
      editingMessageId,
      setEditingMessageId,
      openThread,
      onDeleteMessage,
      onForwardMessage,
      onReply,
      canStartThread,
      canPin,
      onOpenActions,
      toggleFold,
      moveSelection,
      workspaceId,
      conversationId,
      firstNewIndex,
      selectIndex,
      setSelectedMessageId,
    ],
  );

  return {
    selectedMessageIndex,
    deleteConfirmMessageId,
    handleMessageListKeyDown,
    selectPressedMessage,
    moveSelection,
    toggleFold,
  };
}
