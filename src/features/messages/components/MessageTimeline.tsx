import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useConversationMessages } from "../api/useMessages";
import { useEditMessageMutation } from "../api/useEditMessage";
import { useToggleReactionMutation } from "../api/useToggleReaction";
import { useDeleteMessage } from "../hooks/useDeleteMessage";
import { useMessageNavigation } from "../hooks/useMessageNavigation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { cn } from "../../../shared/ui/cn";
import { MessageItem } from "./MessageItem";
import { MessageContextMenu } from "./MessageContextMenu";
import { ForwardDialog } from "./ForwardDialog";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";
import { useLensStore } from "../../lenses/state/useLensStore";
import { useApplyLens, useLenses } from "../../lenses/api/useLenses";
import { LensBanner } from "../../lenses/components/LensBanner";
import { useQueryClient } from "@tanstack/react-query";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useMarkAsRead } from "../../conversations/api/useMarkAsRead";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../api/useMessages";

interface GroupInfo {
  isGrouped: boolean;
  isFirstInGroup: boolean;
}

function computeGroups(
  messages: { authorId: string; sentAt: string; isDeleted?: boolean }[],
): GroupInfo[] {
  return messages.map((msg, i) => {
    if (i === 0) return { isGrouped: false, isFirstInGroup: true };
    const prev = messages[i - 1];
    const sameAuthor = msg.authorId === prev.authorId;
    const within2Min = new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime() < 120_000;
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
    conversationId ? (s.activeLenses[conversationId] ?? null) : null,
  );
  const clearLens = useLensStore((s) => s.setActiveLens);
  const { data: lensesList } = useLenses(workspaceId ?? undefined, conversationId ?? undefined);
  const activeLens = useMemo(
    () => lensesList?.find((l) => l.id === activeLensId) ?? null,
    [lensesList, activeLensId],
  );
  const lensQuery = useApplyLens(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    activeLensId,
  );

  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversationMessages(workspaceId ?? undefined, conversationId ?? undefined);
  const toggleReaction = useToggleReactionMutation();
  const editMessage = useEditMessageMutation();
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);

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
    return [...data.pages].reverse().flatMap((p) => p.items);
  }, [isLensActive, lensQuery.data?.items, data?.pages]);

  const groups = useMemo(() => computeGroups(items), [items]);

  const qc = useQueryClient();

  // Watermark / "New messages" divider
  const watermark = useUnreadStore((s) =>
    conversationId ? (s.watermarks[conversationId] ?? null) : null,
  );
  const clearWatermark = useUnreadStore((s) => s.clearWatermark);
  const { mutate: markAsRead } = useMarkAsRead();
  const dividerRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Track whether we've done the initial scroll-to-divider for this entry
  const didScrollToDividerRef = useRef(false);
  // Index of the first new message (after watermark). -1 means no divider.
  const firstNewIndex = useMemo(() => {
    if (!watermark || isLensActive || items.length === 0) return -1;
    const idx = items.findIndex((m) => m.sentAt > watermark);
    return idx;
  }, [watermark, isLensActive, items]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);

  // Fading state for divider dismissal animation
  const [dividerFading, setDividerFading] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
    messageText: string;
    isOwnMessage: boolean;
    isPinned: boolean;
    hasThread: boolean;
  } | null>(null);

  // Forward dialog state
  const [forwardMessage, setForwardMessage] = useState<{ id: string; text: string } | null>(null);

  const handleDeleteMessage = useCallback(
    async (msg: { id: string }) => {
      await deleteMessageFn(msg.id);
    },
    [deleteMessageFn],
  );

  const handleForwardMessage = useCallback((msg: { id: string; text: string }) => {
    setForwardMessage(msg);
  }, []);

  // C3: Keyboard navigation for message list (vim-style modal)
  const { selectedMessageIndex, deleteConfirmMessageId, handleMessageListKeyDown } =
    useMessageNavigation({
      items,
      conversationId,
      workspaceId,
      currentUserId,
      editingMessageId,
      setEditingMessageId,
      openThread,
      onDeleteMessage: handleDeleteMessage,
      onForwardMessage: handleForwardMessage,
      firstNewIndex,
    });

  // Ref to track the fade-out timer so we can cancel on unmount / conversation switch
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Dismiss the "New messages" divider: fade out, call markAsRead, clear watermark
  const handleDismissDivider = useCallback(() => {
    if (!conversationId || !workspaceId) return;
    // Clear any existing fade timer before starting a new one
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    // Capture current IDs to avoid stale closure
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

  // Track whether user is scrolled to bottom; start 1s dwell timer to dismiss divider
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 50;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    isAtBottomRef.current = atBottom;

    // Dwell-dismiss: if scrolled to bottom and a divider is active, start 1s timer
    if (atBottom && firstNewIndex >= 0) {
      if (!dismissTimerRef.current) {
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          handleDismissDivider();
        }, 1000);
      }
    } else {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    }
  }, [firstNewIndex, handleDismissDivider]);

  // Clean up dwell timer when divider is gone or component unmounts
  useEffect(() => {
    if (firstNewIndex < 0 && dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [firstNewIndex]);
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // Auto-scroll to bottom on initial load and when new messages arrive (if at bottom).
  // When entering a conversation with a watermark, scroll to the divider instead.
  useEffect(() => {
    if (items.length === 0) return;
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      if (firstNewIndex >= 0 && !didScrollToDividerRef.current) {
        // Defer to next frame so the divider element is painted
        requestAnimationFrame(() => {
          dividerRef.current?.scrollIntoView({ block: "start" });
        });
        didScrollToDividerRef.current = true;
      } else {
        bottomRef.current?.scrollIntoView();
      }
      return;
    }
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items.length, firstNewIndex]);

  // Reset initial load, divider-scroll flags, and cancel pending timers when conversation changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    didScrollToDividerRef.current = false;
    setDividerFading(false);
    // Cancel any in-flight dwell or fade timer from the previous conversation
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, [conversationId]);

  // Window blur: when the page hides, snapshot a watermark for the active conversation
  // so new messages arriving while away will show the divider on return.
  useEffect(() => {
    if (!conversationId || !workspaceId) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      // Only snapshot if user was at/near bottom (they were "present" in the convo)
      if (!isAtBottomRef.current) return;
      const cached = qc.getQueryData<{ pages: MessagesPage[] }>(
        queryKeys.messages(workspaceId, conversationId),
      );
      if (cached?.pages && cached.pages.length > 0) {
        const newestPage = cached.pages[0];
        const lastItem = newestPage?.items?.[newestPage.items.length - 1];
        if (lastItem?.sentAt) {
          useUnreadStore.getState().setWatermark(conversationId, lastItem.sentAt);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, workspaceId, qc]);

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

  const handleNavigateToForwardedSource = useCallback(
    (targetConversationId: string, targetMessageId: string) => {
      const shell = useShellStore.getState();
      shell.setSelectedConversationId(targetConversationId);
      shell.setHighlightedMessageId(targetMessageId);
    },
    [],
  );

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
        role="listbox"
        aria-label="Messages"
        aria-activedescendant={selectedMsg ? `message-${selectedMsg.id}` : undefined}
        onScroll={handleScroll}
        onKeyDown={handleMessageListKeyDown}
        onFocus={() => useShellStore.getState().setNavigationMode(true)}
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
            {isLensActive
              ? "No messages match this lens."
              : "No messages yet. Start the conversation below."}
          </p>
        ) : (
          items.map((msg, index) => {
            const member = memberLookup.resolve(msg.authorId);
            const name =
              member.displayName ||
              msg.author?.displayName ||
              msg.author?.username ||
              msg.authorId.slice(0, 8);
            const group = groups[index] ?? { isGrouped: false, isFirstInGroup: true };
            return (
              <div key={msg.id}>
                {index === firstNewIndex && (
                  <div
                    ref={dividerRef}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 transition-opacity duration-1000",
                      dividerFading ? "opacity-0" : "opacity-100",
                    )}
                    role="separator"
                    aria-label="New messages"
                    data-new-messages-divider
                  >
                    <div className="flex-1 border-t border-rim-warm/40" />
                    <span className="select-none text-xs font-medium text-rim-warm">
                      New messages
                    </span>
                    <div className="flex-1 border-t border-rim-warm/40" />
                  </div>
                )}
                <MessageItem
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
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Action hints bar -- shown in navigation mode */}
      {navigationMode && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center pb-1">
          <div
            className={cn(
              "inline-flex items-center gap-3 rounded border border-rim-line bg-rim-panel px-3 py-1.5",
              "text-[10px] text-rim-text-faint shadow-lg transition-opacity duration-150",
            )}
          >
            <span className="font-medium text-rim-accent">NAVIGATE</span>
            <span className="text-rim-line">|</span>
            <span>
              <kbd className="font-mono">j/k</kbd> Navigate
            </span>
            {selectedMessageIndex >= 0 && (
              <>
                <span>
                  <kbd className="font-mono">r</kbd> Reply
                </span>
                {isSelectedOwnMessage && (
                  <span>
                    <kbd className="font-mono">e</kbd> Edit
                  </span>
                )}
                <span>
                  <kbd className="font-mono">t</kbd> Thread
                </span>
                <span>
                  <kbd className="font-mono">p</kbd> Pin
                </span>
                <span>
                  <kbd className="font-mono">c</kbd> Copy
                </span>
                <span>
                  <kbd className="font-mono">f</kbd> Forward
                </span>
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
            {firstNewIndex >= 0 && (
              <span>
                <kbd className="font-mono">⇧N</kbd> Jump to new
              </span>
            )}
            <span>
              <kbd className="font-mono">/</kbd> Search
            </span>
            <span>
              <kbd className="font-mono">i</kbd> Compose
            </span>
            <span>
              <kbd className="font-mono">Esc</kbd> Exit
            </span>
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
          onClose={() => {
            setForwardMessage(null);
            scrollContainerRef.current?.focus();
          }}
          messageId={forwardMessage.id}
          messageText={forwardMessage.text}
          workspaceId={workspaceId}
          sourceConversationId={conversationId}
        />
      )}
    </div>
  );
}
