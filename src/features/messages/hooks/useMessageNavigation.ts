import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { toast } from "../../../shared/toast";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import { vimModeEnabled } from "../../commands/state/useKeybindProfileStore";
import { useMessageFoldStore } from "../state/useMessageFoldStore";

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
   * list focus; entering NAVIGATE then selects it, or the newest message, without scrolling.
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
  // Selection is tracked by message id so it stays on the same message when
  // older pages are prepended (which shifts every index).
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const selectedMessageIndex = useMemo(
    () => (selectedMessageId ? items.findIndex((m) => m.id === selectedMessageId) : -1),
    [items, selectedMessageId],
  );
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();

  // Stabilize mutation functions via refs so the handleMessageListKeyDown
  // callback is not recreated every render (useMutation returns new objects).
  const pinMessageRef = useRef(pinMessage.mutate);
  const unpinMessageRef = useRef(unpinMessage.mutate);
  useLayoutEffect(() => {
    pinMessageRef.current = pinMessage.mutate;
    unpinMessageRef.current = unpinMessage.mutate;
  }, [pinMessage.mutate, unpinMessage.mutate]);

  /** Select a row and scroll it into view. */
  const selectIndex = useCallback(
    (index: number) => {
      const msg = items[index];
      if (!msg) return;
      setSelectedMessageId(msg.id);
      scrollToIndex(index);
    },
    [items, scrollToIndex],
  );

  // Reset the selection and the pending delete when the conversation changes, while rendering
  // it, and the editing state and the delete timer once it is shown.
  const [selectionConversationId, setSelectionConversationId] = useState(conversationId);
  if (selectionConversationId !== conversationId) {
    setSelectionConversationId(conversationId);
    setSelectedMessageId(null);
    setDeleteConfirmMessageId(null);
  }
  useEffect(() => {
    setEditingMessageId(null);
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
    }
  }, [conversationId, setEditingMessageId]);

  // Auto-select newest message when entering navigation mode
  useEffect(() => {
    const unsub = useShellStore.subscribe((state, prev) => {
      if (state.navigationMode && !prev.navigationMode) {
        if (selectedMessageIndex === -1 && items.length > 0) {
          const pressed = pointerEntryRef.current;
          if (pressed !== null) {
            setSelectedMessageId(
              items.some((m) => m.id === pressed) ? pressed : items[items.length - 1].id,
            );
          } else {
            selectIndex(items.length - 1);
          }
        }
      }
    });
    return unsub;
  }, [selectedMessageIndex, items, selectIndex, pointerEntryRef]);

  // Clean up delete confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
      }
    };
  }, []);

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
        setDeleteConfirmMessageId(null);
        selectIndex(e.key === "Home" ? 0 : items.length - 1);
        return;
      }

      // Navigation: j/k and ArrowDown/ArrowUp
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setDeleteConfirmMessageId(null);
        selectIndex(Math.min(selectedMessageIndex + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setDeleteConfirmMessageId(null);
        selectIndex(selectedMessageIndex <= 0 ? 0 : selectedMessageIndex - 1);
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
          const vars = { serverId: workspaceId, conversationId, messageId: msg.id };
          if (msg.isPinned) {
            unpinMessageRef.current(vars);
            toast.success("Message unpinned");
          } else {
            pinMessageRef.current(vars);
            toast.success("Message pinned");
          }
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
          const fold = useMessageFoldStore.getState();
          if (msg.id === editingMessageId || !fold.foldable.has(msg.id)) break;
          e.preventDefault();
          onFoldToggle?.(msg.id, !fold.expanded.has(msg.id));
          fold.toggleExpanded(msg.id);
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
      onFoldToggle,
      workspaceId,
      conversationId,
      firstNewIndex,
      selectIndex,
    ],
  );

  return {
    selectedMessageIndex,
    deleteConfirmMessageId,
    handleMessageListKeyDown,
  };
}
