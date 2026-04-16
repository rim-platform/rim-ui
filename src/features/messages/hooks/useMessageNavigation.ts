import { useState, useEffect, useRef, useCallback } from "react";
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
}: UseMessageNavigationOptions) {
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(-1);
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

  // Reset selected message and editing state when conversation changes
  useEffect(() => {
    setSelectedMessageIndex(-1);
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
          setSelectedMessageIndex(items.length - 1);
        }
      }
    });
    return unsub;
  }, [selectedMessageIndex, items.length]);

  // Clean up delete confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current);
      }
    };
  }, []);

  // Scroll selected message into view
  useEffect(() => {
    if (selectedMessageIndex < 0) return;
    const msg = items[selectedMessageIndex];
    if (!msg) return;
    const el = document.querySelector(`[data-message-id="${msg.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedMessageIndex, items]);

  const handleMessageListKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Skip when a text input is focused (e.g. message edit textarea)
    const target = e.target as HTMLElement;
    if (
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.isContentEditable
    ) {
      return;
    }

    const navMode = useShellStore.getState().navigationMode;

    // Escape always works: exit navigation mode and return to composer
    if (e.key === "Escape") {
      e.preventDefault();
      setSelectedMessageIndex(-1);
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
        setSelectedMessageIndex(firstNewIndex);
      }
      return;
    }

    // Navigation: j/k and ArrowDown/ArrowUp
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setDeleteConfirmMessageId(null);
      setSelectedMessageIndex((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setDeleteConfirmMessageId(null);
      setSelectedMessageIndex((i) => (i <= 0 ? 0 : i - 1));
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
        useSearchOverlayStore.getState().openWithScope(
          conversationId
            ? { kind: "conversation", conversationId }
            : { kind: "all" },
        );
        break;
      }
    }
  }, [items, selectedMessageIndex, deleteConfirmMessageId, currentUserId, editingMessageId, setEditingMessageId, openThread, onDeleteMessage, onForwardMessage, workspaceId, conversationId, firstNewIndex]);

  return {
    selectedMessageIndex,
    deleteConfirmMessageId,
    handleMessageListKeyDown,
  };
}
