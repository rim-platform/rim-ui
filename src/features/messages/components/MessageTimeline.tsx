import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";

import { useConversationMessages } from "../api/useMessages";
import { useToggleReactionMutation } from "../api/useToggleReaction";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useShellStore } from "../../../shell/state/useShellStore";
import { MessageItem } from "./MessageItem";
import { MessageContextMenu } from "./MessageContextMenu";
import { Composer } from "./Composer";

export function MessageTimeline() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const { resolve } = useMemberLookup(workspaceId ?? undefined);
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

  // Flatten all pages into a single list, reversed for newest-at-bottom display.
  // Backend returns items newest-first (DESC); pages array has newest page first.
  // We reverse both: pages order and items within each page, so result is oldest->newest.
  const items = useMemo(() => {
    if (!data?.pages) return [];
    const allItems = [];
    // Iterate pages in reverse (oldest page first)
    for (let i = data.pages.length - 1; i >= 0; i--) {
      const page = data.pages[i];
      // Items within each page are newest-first, so reverse them
      for (let j = page.items.length - 1; j >= 0; j--) {
        allItems.push(page.items[j]);
      }
    }
    return allItems;
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
  } | null>(null);

  // C3: Selected message index for keyboard navigation
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(-1);

  // Reset selected message when conversation changes
  useEffect(() => {
    setSelectedMessageIndex(-1);
  }, [conversationId]);

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
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      messageId,
      messageText,
    });
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
        // Edit own message (placeholder - would need edit mutation)
        const member = resolve(msg.authorId);
        if (member.isCurrentUser) {
          e.preventDefault();
          // Edit functionality would go here
        }
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        if (msg.text) {
          navigator.clipboard.writeText(msg.text);
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
      <div className="flex flex-1 items-center justify-center text-sm text-red-300">
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
            const member = resolve(msg.authorId);
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                authorName={member.displayName}
                authorInitial={member.displayName.charAt(0).toUpperCase()}
                isCurrentUser={member.isCurrentUser}
                reactions={msg.reactions}
                isSelected={index === selectedMessageIndex}
                onOpenThread={openThread}
                onToggleReaction={handleToggleReaction}
                onContextMenu={handleContextMenu}
                resolveMember={resolve}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <Composer workspaceId={workspaceId!} conversationId={conversationId} />
      {contextMenu && workspaceId && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageId={contextMenu.messageId}
          messageText={contextMenu.messageText}
          conversationId={conversationId}
          workspaceId={workspaceId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
