import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";

import { useConversationMessages } from "../api/useMessages";
import { useEditMessageMutation } from "../api/useEditMessage";
import { useToggleReactionMutation } from "../api/useToggleReaction";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { MessageItem } from "./MessageItem";
import { MessageContextMenu } from "./MessageContextMenu";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";
import { toast } from "../../../shared/toast";

export function MessageTimeline() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const editingMessageId = useShellStore((s) => s.editingMessageId);
  const setEditingMessageId = useShellStore((s) => s.setEditingMessageId);
  const highlightedMessageId = useShellStore((s) => s.highlightedMessageId);
  const setHighlightedMessageId = useShellStore((s) => s.setHighlightedMessageId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const presenceMap = usePresenceStore((s) => s.presenceMap);

  // Build userId → displayName map for mention rendering
  const memberDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, info] of memberLookup.map) {
      map.set(userId, info.displayName);
    }
    return map;
  }, [memberLookup.map]);
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

  // Flatten all pages into a single list for display (oldest->newest).
  // Backend returns items in display order (oldest-first within each page).
  // Pages are in load order (newest first), so reverse pages for display.
  const items = useMemo(() => {
    if (!data?.pages) return [];
    return [...data.pages].reverse().flatMap(p => p.items);
  }, [data?.pages]);

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

  // Reset selected message and editing state when conversation changes
  useEffect(() => {
    setSelectedMessageIndex(-1);
    setEditingMessageId(null);
  }, [conversationId, setEditingMessageId]);

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

  // C3: Keyboard navigation for message list
  function handleMessageListKeyDown(e: React.KeyboardEvent) {
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedMessageIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedMessageIndex((i) => (i <= 0 ? 0 : i - 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSelectedMessageIndex(-1);
      // Return focus to composer is handled by blur
      scrollContainerRef.current?.blur();
    } else if (selectedMessageIndex >= 0) {
      const msg = items[selectedMessageIndex];
      if (!msg) return;

      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        openThread(msg.id);
      } else if (e.key === "e" || e.key === "E") {
        if (editingMessageId) return;
        if (msg.author?.id === currentUserId) {
          e.preventDefault();
          setEditingMessageId(msg.id);
        }
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        if (msg.text) {
          navigator.clipboard.writeText(msg.text);
          toast.success("Copied to clipboard");
        }
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

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-text-muted">
        Loading messages...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-danger">
        Failed to load messages.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
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
          <p className="py-8 text-center text-sm text-rim-text-muted">No messages yet. Start the conversation below.</p>
        ) : (
          items.map((msg, index) => {
            const member = memberLookup.resolve(msg.authorId);
            const name = member.displayName || msg.author?.displayName || msg.author?.username || msg.authorId.slice(0, 8);
            const presence = presenceMap[msg.authorId];
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
                authorPresenceStatus={presence === "ONLINE" || presence === "AWAY" || presence === "OFFLINE" ? presence : null}
                isCurrentUser={msg.author?.id === currentUserId}
                reactions={msg.reactions}
                isSelected={index === selectedMessageIndex}
                isEditing={msg.id === editingMessageId}
                editError={msg.id === editingMessageId && editMessage.isError}
                onOpenThread={openThread}
                onToggleReaction={handleToggleReaction}
                onContextMenu={handleContextMenu}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                resolveMember={memberLookup.resolve}
                memberDisplayMap={memberDisplayMap}
                linkPreviews={msg.linkPreviews}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
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
        />
      )}
    </div>
  );
}
