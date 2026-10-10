import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { toast } from "../../../shared/toast";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";

interface MessageNavItem {
  id: string;
  text?: string | null;
  isPinned?: boolean;
  author?: { id: string } | null;
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
  /** Index of the first new message after the watermark, or -1 if no divider. */
  firstNewIndex?: number;
  /**
   * Bring a row into view. The list is virtualized, so the selected row may
   * not be mounted; the caller scrolls by index rather than by DOM node.
   */
  scrollToIndex: (index: number) => void;
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
  firstNewIndex = -1,
  scrollToIndex,
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
  pinMessageRef.current = pinMessage.mutate;
  const unpinMessageRef = useRef(unpinMessage.mutate);
  unpinMessageRef.current = unpinMessage.mutate;

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

  // Reset selected message and editing state when conversation changes
  useEffect(() => {
    setSelectedMessageId(null);
    setEditingMessageId(null);
    setDeleteConfirmMessageId(null);
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
    }
  }, [conversationId, setEditingMessageId]);

  // Auto-select newest message when entering navigation mode
  useEffect(() => {
    const unsub = useShellStore.subscribe((state, prev) => {
      if (state.navigationMode && !prev.navigationMode) {
        if (selectedMessageIndex === -1 && items.length > 0) {
          selectIndex(items.length - 1);
        }
      }
    });
    return unsub;
  }, [selectedMessageIndex, items.length, selectIndex]);

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

      // Escape always works: exit navigation mode and return to composer
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedMessageId(null);
        setDeleteConfirmMessageId(null);
        useShellStore.getState().setNavigationMode(false);
        document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
        return;
      }

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
      const isOwnMessage = msg.author?.id === currentUserId;

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
        // Both r (reply) and t (thread) open the thread panel. In RIM,
        // threads ARE the reply mechanism — there is no separate inline
        // reply context. Two keybinds for discoverability: "r" for users
        // expecting reply semantics, "t" for those expecting thread.
        case "r":
        case "t": {
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
