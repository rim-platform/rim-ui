import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Send, X } from "lucide-react";

import {
  useThreadByRootMessage,
  useThreadMessages,
} from "../api/useThreads";
import { useReplyToMessageMutation } from "../api/useReplyToMessage";
import { useConversationMessages } from "../../messages/api/useMessages";
import { useToggleReactionMutation } from "../../messages/api/useToggleReaction";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { replaceShortcodes } from "../../messages/utils/emojiShortcodes";
import { MessageItem } from "../../messages/components/MessageItem";
import { logger } from "../../../core/logger";

export function ThreadPanel() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const rootMessageId = useShellStore((s) => s.selectedRootMessageId);
  const closeThread = useShellStore((s) => s.closeThread);
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const highlightedMessageId = useShellStore((s) => s.highlightedMessageId);
  const setHighlightedMessageId = useShellStore((s) => s.setHighlightedMessageId);

  const threadByRoot = useThreadByRootMessage(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    rootMessageId ?? undefined,
  );
  const thread = threadByRoot.data;

  const threadId = thread?.id;

  const threadMsgs = useThreadMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    threadId ?? undefined,
  );
  const threadMessages = threadMsgs.data;

  // Debug: trace the entire data chain
  logger.debug("[ThreadPanel] rootMessageId:", rootMessageId);
  logger.debug("[ThreadPanel] threadByRoot:", thread, "status:", threadByRoot.status, "error:", threadByRoot.error);
  logger.debug("[ThreadPanel] threadId:", threadId);
  logger.debug("[ThreadPanel] threadMessages enabled:", Boolean(workspaceId && conversationId && threadId));
  logger.debug("[ThreadPanel] threadMessages data:", threadMessages, "status:", threadMsgs.status, "error:", threadMsgs.error);
  logger.debug("[ThreadPanel] threadMessages items:", threadMessages?.items?.length);

  const currentUserId = useAuthStore((s) => s.session?.userId);
  const toggleReaction = useToggleReactionMutation();

  // Get the root message from the conversation messages cache
  const { data: conversationData } = useConversationMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
  );

  // Try to find root message in conversation cache; fall back to thread metadata
  const rootMessage = useMemo(() => {
    if (!rootMessageId) return null;

    // First: try conversation messages cache
    if (conversationData?.pages) {
      for (const page of conversationData.pages) {
        const found = page.items.find((m) => m.id === rootMessageId);
        if (found) return found;
      }
    }

    // Fallback: synthesize from thread metadata (when root message scrolled out of cache)
    if (thread) {
      return {
        id: rootMessageId,
        serverId: thread.serverId,
        conversationId: thread.conversationId,
        threadId: null,
        rootThreadId: thread.id,
        authorId: thread.rootAuthorId,
        author: null,
        text: thread.rootText ?? "",
        hasAttachments: false,
        parentMessageId: null,
        isDeleted: false,
        sentAt: thread.createdAt,
        reactions: [],
        attachments: [],
        linkPreviews: [],
      };
    }

    return null;
  }, [conversationData?.pages, rootMessageId, thread]);

  // Backend returns thread messages in display order (oldest-first); no reverse needed.
  const items = useMemo(() => {
    return threadMessages?.items ?? [];
  }, [threadMessages?.items]);
  const replyCount = items.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track whether user is scrolled to bottom
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const threshold = 50;
    isAtBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Auto-scroll to bottom when new replies arrive, only if already at bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items.length]);

  // Scroll to highlighted message (from search) and clear after a brief highlight.
  // Uses a 300ms delay to wait for thread messages to render (async query).
  useEffect(() => {
    if (!highlightedMessageId || !scrollRef.current) return;

    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(
        `[data-message-id="${highlightedMessageId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bg-rim-accent/10");
        setTimeout(() => el.classList.remove("bg-rim-accent/10"), 1500);
      }
      setHighlightedMessageId(null);
    }, 300);

    return () => clearTimeout(timer);
  }, [highlightedMessageId, setHighlightedMessageId, items]);

  function handleToggleReaction(messageId: string, emoji: string) {
    if (!workspaceId || !conversationId) return;
    toggleReaction.mutate({
      serverId: workspaceId,
      conversationId,
      messageId,
      emoji,
    });
  }

  // No-op context menu for thread messages (simplified)
  function handleContextMenu(_event: React.MouseEvent, _messageId: string, _messageText: string) {
    // Context menu not supported in thread panel
  }

  if (!rootMessageId) return null;

  const headerText = !thread
    ? "Thread"
    : replyCount === 0
      ? "Thread"
      : `Thread \u2014 ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;

  return (
    <div className="flex h-full flex-col rounded-xl border border-rim-line bg-rim-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h3 className="text-sm font-medium text-rim-text">{headerText}</h3>
        <button
          type="button"
          onClick={closeThread}
          className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
          aria-label="Close thread"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Root message */}
      {rootMessage && (() => {
        const name = rootMessage.author?.displayName || rootMessage.author?.username || rootMessage.authorId.slice(0, 8);
        return (
          <div className="border-b border-rim-line px-4 py-3">
            <MessageItem
              message={rootMessage}
              authorName={name}
              authorInitial={name.charAt(0).toUpperCase()}
              authorAvatarUrl={rootMessage.author?.avatarUrl}
              isCurrentUser={rootMessage.author?.id === currentUserId}
              reactions={rootMessage.reactions}
              onOpenThread={openThread}
              onToggleReaction={handleToggleReaction}
              onContextMenu={handleContextMenu}
              linkPreviews={rootMessage.linkPreviews}
            />
          </div>
        );
      })()}

      {/* Thread replies — scrollable area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
      >
        {items.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-rim-text-muted">
            Be the first to reply
          </p>
        ) : (
          items.map((msg) => {
            const name = msg.author?.displayName || msg.author?.username || msg.authorId.slice(0, 8);
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                authorName={name}
                authorInitial={name.charAt(0).toUpperCase()}
                authorAvatarUrl={msg.author?.avatarUrl}
                isCurrentUser={msg.author?.id === currentUserId}
                reactions={msg.reactions}
                onOpenThread={openThread}
                onToggleReaction={handleToggleReaction}
                onContextMenu={handleContextMenu}
                linkPreviews={msg.linkPreviews}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer — always visible */}
      {workspaceId && conversationId && (
        <ThreadComposer
          workspaceId={workspaceId}
          conversationId={conversationId}
          rootMessageId={rootMessageId}
        />
      )}
    </div>
  );
}

function ThreadComposer({
  workspaceId,
  conversationId,
  rootMessageId,
}: {
  workspaceId: string;
  conversationId: string;
  rootMessageId: string;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyToMessage = useReplyToMessageMutation();

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const processed = replaceShortcodes(trimmed);

    replyToMessage.mutate(
      {
        serverId: workspaceId,
        conversationId,
        rootMessageId,
        text: processed,
      },
      {
        onSuccess: () => {
          setText("");
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          textareaRef.current?.focus();
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.currentTarget.value);
    // Auto-resize
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-rim-line px-4 py-3">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Reply in thread..."
        className="flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        style={{ height: "auto" }}
      />
      <button
        type="submit"
        disabled={replyToMessage.isPending || !text.trim()}
        className="rounded-lg bg-rim-accent p-2 text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
        aria-label="Send reply"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
