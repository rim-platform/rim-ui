import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { useConversationMessages } from "../api/useMessages";
import type { MessagesPage } from "../api/useMessages";
import { useEditMessageMutation } from "../api/useEditMessage";
import { useToggleReactionMutation } from "../api/useToggleReaction";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { queryKeys } from "../../../core/query/keys";
import { cn } from "../../../shared/ui/cn";
import { MessageItem } from "./MessageItem";
import { MessageContextMenu } from "./MessageContextMenu";
import { ForwardDialog } from "./ForwardDialog";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";
import { toast } from "../../../shared/toast";
import { useLensStore } from "../../lenses/state/useLensStore";
import { useApplyLens, useLenses } from "../../lenses/api/useLenses";
import { LensBanner } from "../../lenses/components/LensBanner";

interface GroupInfo {
  isGrouped: boolean;
  isFirstInGroup: boolean;
}

function computeGroups(messages: { authorId: string; sentAt: string; isDeleted?: boolean }[]): GroupInfo[] {
  return messages.map((msg, i) => {
    if (i === 0) return { isGrouped: false, isFirstInGroup: true };
    const prev = messages[i - 1];
    const sameAuthor = msg.authorId === prev.authorId;
    const within2Min =
      new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime() < 120_000;
    const isGrouped = sameAuthor && within2Min && !prev.isDeleted;
    return { isGrouped, isFirstInGroup: !isGrouped };
  });
}

export function MessageTimeline() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const editingMessageId = useShellStore((s) => s.editingMessageId);
  const setEditingMessageId = useShellStore((s) => s.setEditingMessageId);
  const highlightedMessageId = useShellStore((s) => s.highlightedMessageId);
  const setHighlightedMessageId = useShellStore((s) => s.setHighlightedMessageId);
  const displayDensity = useShellStore((s) => s.displayDensity);
  const navigationMode = useShellStore((s) => s.navigationMode);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);

  // Build userId → displayName map for mention rendering
  const memberDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, info] of memberLookup.map) {
      map.set(userId, info.displayName);
    }
    return map;
  }, [memberLookup.map]);

  // --- Lens integration ---
  const activeLensId = useLensStore((s) =>
    conversationId ? s.activeLenses[conversationId] ?? null : null,
  );
  const clearLens = useLensStore((s) => s.setActiveLens);
  const { data: lensesList } = useLenses(
    workspaceId ?? undefined,
    conversationId ?? undefined,
  );
  const activeLens = useMemo(
    () => lensesList?.find((l) => l.id === activeLensId) ?? null,
    [lensesList, activeLensId],
  );
  const lensQuery = useApplyLens(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    activeLensId,
  );

  const {
    data,
    isPending,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useConversationMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
  );
  const toggleReaction = useToggleReactionMutation();
  const editMessage = useEditMessageMutation();
  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();
  const executeCommandMutation = useExecuteCommandMutation();
  const qc = useQueryClient();

  // Flatten all pages into a single list for display (oldest->newest).
  // Backend returns items in display order (oldest-first within each page).
  // Pages are in load order (newest first), so reverse pages for display.
  // When a lens is active, use the lens query results instead.
  const isLensActive = Boolean(activeLensId);
  const items = useMemo(() => {
    if (isLensActive) {
      return lensQuery.data?.items ?? [];
    }
    if (!data?.pages) return [];
    return [...data.pages].reverse().flatMap(p => p.items);
  }, [isLensActive, lensQuery.data?.items, data?.pages]);

  const groups = useMemo(() => computeGroups(items), [items]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
    messageText: string;
    isOwnMessage: boolean;
    isPinned: boolean;
    hasThread: boolean;
  } | null>(null);

  // C3: Selected message index for keyboard navigation
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(-1);
  // Delete confirmation: press d once to arm, press d again within 2s to confirm
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Forward dialog state
  const [forwardMessage, setForwardMessage] = useState<{ id: string; text: string } | null>(null);

  // Reset selected message and editing state when conversation changes
  useEffect(() => {
    setSelectedMessageIndex(-1);
    setEditingMessageId(null);
    setDeleteConfirmMessageId(null);
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current);
    }
  }, [conversationId, setEditingMessageId]);

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
    if (selectedMessageIndex < 0 || !scrollContainerRef.current) return;
    const msg = items[selectedMessageIndex];
    if (!msg) return;
    const el = scrollContainerRef.current.querySelector(
      `[data-message-id="${msg.id}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedMessageIndex, items]);

  // Track whether user is scrolled to bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 50;
    isAtBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Auto-scroll to bottom on initial load and when new messages arrive (if at bottom)
  useEffect(() => {
    if (items.length === 0) return;
    if (isInitialLoadRef.current) {
      bottomRef.current?.scrollIntoView();
      isInitialLoadRef.current = false;
      return;
    }
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items.length]);

  // Reset initial load flag when conversation changes
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [conversationId]);

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isInitialLoadRef.current) return;
    if (prevScrollHeightRef.current > 0 && isFetchingNextPage === false) {
      const newScrollHeight = container.scrollHeight;
      const delta = newScrollHeight - prevScrollHeightRef.current;
      if (delta > 0) {
        container.scrollTop = container.scrollTop + delta;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [data?.pages?.length, isFetchingNextPage]);

  // Scroll to highlighted message (from search) and clear after a brief highlight
  useEffect(() => {
    if (!highlightedMessageId || !scrollContainerRef.current) return;
    if (!/^[\w-]+$/.test(highlightedMessageId)) {
      setHighlightedMessageId(null);
      return;
    }
    const el = scrollContainerRef.current.querySelector(
      `[data-message-id="${highlightedMessageId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-rim-accent/10");
      const timer = setTimeout(() => {
        el.classList.remove("bg-rim-accent/10");
        setHighlightedMessageId(null);
      }, 1500);
      return () => clearTimeout(timer);
    }
    setHighlightedMessageId(null);
  }, [highlightedMessageId, setHighlightedMessageId, items]);

  // IntersectionObserver on top sentinel to trigger loading older messages
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          prevScrollHeightRef.current = container.scrollHeight;
          fetchNextPage();
        }
      },
      { root: container, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  function handleContextMenu(event: React.MouseEvent, messageId: string, messageText: string) {
    const msg = items.find((m) => m.id === messageId);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      messageId,
      messageText,
      isOwnMessage: msg?.author?.id === currentUserId,
      isPinned: msg?.isPinned === true,
      hasThread: !!(msg?.threadId || msg?.rootThreadId),
    });
  }

  async function handleSaveEdit(messageId: string, newText: string) {
    if (!workspaceId || !conversationId) return;
    try {
      await editMessage.mutateAsync({
        serverId: workspaceId,
        conversationId,
        messageId,
        text: newText,
      });
      setEditingMessageId(null);
    } catch {
      // Keep edit mode open — user can retry or cancel
    }
  }

  function handleCancelEdit() {
    setEditingMessageId(null);
  }

  function handleToggleReaction(messageId: string, emoji: string) {
    if (!workspaceId || !conversationId) return;
    toggleReaction.mutate({
      serverId: workspaceId,
      conversationId,
      messageId,
      emoji,
    });
  }

  // Handle delete with confirmation (press d twice within 2s)
  const handleDeleteMessage = useCallback(async (msg: { id: string }) => {
    if (!workspaceId || !conversationId) return;
    const messagesKey = queryKeys.messages(workspaceId, conversationId);
    const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);
    qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((m) =>
            m.id === msg.id ? { ...m, isDeleted: true, text: "" } : m,
          ),
        })),
      };
    });
    try {
      await executeCommandMutation.mutateAsync({
        commandId: "chat.delete_message",
        commandContext: {
          workspaceId,
          conversationId,
          selectedMessageId: msg.id,
        },
        confirmedDangerous: true,
      });
    } catch {
      if (previousData) {
        qc.setQueryData(messagesKey, previousData);
      }
      toast.error("Failed to delete message");
    }
  }, [workspaceId, conversationId, executeCommandMutation, qc]);

  const handleNavigateToForwardedSource = useCallback(
    (targetConversationId: string, targetMessageId: string) => {
      const shell = useShellStore.getState();
      shell.setSelectedConversationId(targetConversationId);
      shell.setHighlightedMessageId(targetMessageId);
    },
    [],
  );

  // C3: Keyboard navigation for message list (vim-style modal)
  // Navigation mode is entered via Escape from composer (or workspace.focus_message_list command).
  // Press i or Enter to exit navigation mode and return to composer.
  function handleMessageListKeyDown(e: React.KeyboardEvent) {
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
        void handleDeleteMessage(msg);
      } else {
        // Cancel delete confirmation
        if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
        setDeleteConfirmMessageId(null);
      }
      return;
    }

    switch (e.key) {
      case "r": {
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
      case "t": {
        e.preventDefault();
        openThread(msg.id);
        break;
      }
      case "p": {
        e.preventDefault();
        if (!workspaceId || !conversationId) break;
        const vars = { serverId: workspaceId, conversationId, messageId: msg.id };
        if (msg.isPinned) {
          unpinMessage.mutate(vars);
          toast.success("Message unpinned");
        } else {
          pinMessage.mutate(vars);
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
        setForwardMessage({ id: msg.id, text: msg.text ?? "" });
        break;
      }
    }
  }

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-text-muted">
        Select a conversation
      </div>
    );
  }

  const effectivePending = isLensActive ? lensQuery.isPending : isPending;
  const effectiveError = isLensActive ? lensQuery.isError : isError;

  if (effectivePending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-text-muted">
        {isLensActive ? "Applying lens..." : "Loading messages..."}
      </div>
    );
  }

  if (effectiveError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-danger">
        {isLensActive ? "Failed to apply lens." : "Failed to load messages."}
      </div>
    );
  }

  const selectedMsg = selectedMessageIndex >= 0 ? items[selectedMessageIndex] : null;
  const isSelectedOwnMessage = selectedMsg?.author?.id === currentUserId;

  return (
    <div
      data-panel="mainSurface"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("mainSurface")}
      className="relative flex flex-1 flex-col overflow-hidden outline-none"
    >
      {/* Lens banner */}
      {isLensActive && activeLens && conversationId && (
        <LensBanner
          lensName={activeLens.name}
          conditionCount={activeLens.filterSpec.conditions.length}
          onClear={() => clearLens(conversationId, null)}
        />
      )}
      <div
        ref={scrollContainerRef}
        data-message-list
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleMessageListKeyDown}
        className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3 outline-none"
      >
        {/* Top sentinel for infinite scroll trigger */}
        <div ref={topSentinelRef} className="h-1" />
        {isFetchingNextPage && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-rim-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading older messages...
          </div>
        )}
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-rim-text-muted">
            {isLensActive ? "No messages match this lens." : "No messages yet. Start the conversation below."}
          </p>
        ) : (
          items.map((msg, index) => {
            const member = memberLookup.resolve(msg.authorId);
            const name = member.displayName || msg.author?.displayName || msg.author?.username || msg.authorId.slice(0, 8);
            const group = groups[index] ?? { isGrouped: false, isFirstInGroup: true };
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                authorName={name}
                authorInitial={name.charAt(0).toUpperCase()}
                authorAvatarUrl={member.avatarUrl ?? msg.author?.avatarUrl}
                authorUsername={member.username ?? msg.author?.username}
                authorStatusText={member.statusText}
                authorRole={member.role}
                authorJoinedAt={member.joinedAt}
                authorBio={member.bio}
                isCurrentUser={msg.author?.id === currentUserId}
                reactions={msg.reactions}
                isSelected={index === selectedMessageIndex}
                isDeleteConfirming={msg.id === deleteConfirmMessageId}
                isEditing={msg.id === editingMessageId}
                editError={msg.id === editingMessageId && editMessage.isError}
                isGrouped={group.isGrouped}
                isFirstInGroup={group.isFirstInGroup}
                displayDensity={displayDensity}
                onOpenThread={openThread}
                onToggleReaction={handleToggleReaction}
                onContextMenu={handleContextMenu}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onNavigateToForwardedSource={handleNavigateToForwardedSource}
                resolveMember={memberLookup.resolve}
                memberDisplayMap={memberDisplayMap}
                linkPreviews={msg.linkPreviews}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Action hints bar -- shown in navigation mode */}
      {navigationMode && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center pb-1">
          <div className={cn(
            "inline-flex items-center gap-3 rounded border border-rim-line bg-rim-panel px-3 py-1.5",
            "text-[10px] text-rim-text-faint shadow-lg transition-opacity duration-150",
          )}>
            <span className="font-medium text-rim-accent">NAVIGATE</span>
            <span className="text-rim-line">|</span>
            <span><kbd className="font-mono">j/k</kbd> Navigate</span>
            {selectedMessageIndex >= 0 && (
              <>
                <span><kbd className="font-mono">r</kbd> Reply</span>
                {isSelectedOwnMessage && <span><kbd className="font-mono">e</kbd> Edit</span>}
                <span><kbd className="font-mono">t</kbd> Thread</span>
                <span><kbd className="font-mono">p</kbd> Pin</span>
                <span><kbd className="font-mono">c</kbd> Copy</span>
                <span><kbd className="font-mono">f</kbd> Forward</span>
                {isSelectedOwnMessage && (
                  <span>
                    <kbd className="font-mono">d</kbd>{" "}
                    {deleteConfirmMessageId ? (
                      <span className="font-medium text-rim-danger">Press d again to delete</span>
                    ) : (
                      "Delete"
                    )}
                  </span>
                )}
              </>
            )}
            <span className="text-rim-line">|</span>
            <span><kbd className="font-mono">i</kbd> Compose</span>
            <span><kbd className="font-mono">Esc</kbd> Exit</span>
          </div>
        </div>
      )}

      <TypingIndicator conversationId={conversationId} />
      {workspaceId && <Composer workspaceId={workspaceId} conversationId={conversationId} />}
      {contextMenu && workspaceId && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageId={contextMenu.messageId}
          messageText={contextMenu.messageText}
          conversationId={conversationId}
          workspaceId={workspaceId}
          isOwnMessage={contextMenu.isOwnMessage}
          isPinned={contextMenu.isPinned}
          hasThread={contextMenu.hasThread}
          onClose={() => setContextMenu(null)}
          onForward={(msgId, msgText) => setForwardMessage({ id: msgId, text: msgText })}
        />
      )}
      {forwardMessage && workspaceId && (
        <ForwardDialog
          open={!!forwardMessage}
          onClose={() => setForwardMessage(null)}
          messageId={forwardMessage.id}
          messageText={forwardMessage.text}
          workspaceId={workspaceId}
          sourceConversationId={conversationId}
        />
      )}
    </div>
  );
}
