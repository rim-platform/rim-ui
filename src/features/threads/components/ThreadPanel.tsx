import { useEffect, useRef, useState, useMemo } from "react";
import { Send, X } from "lucide-react";

import {
  useThreadByRootMessage,
  useThreadMessages,
} from "../api/useThreads";
import { useReplyToMessageMutation } from "../api/useReplyToMessage";
import { useConversationMessages } from "../../messages/api/useMessages";
import { useToggleReactionMutation } from "../../messages/api/useToggleReaction";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useShellStore } from "../../../shell/state/useShellStore";
import { replaceShortcodes } from "../../messages/utils/emojiShortcodes";
import { MessageItem } from "../../messages/components/MessageItem";

export function ThreadPanel() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const rootMessageId = useShellStore((s) => s.selectedRootMessageId);
  const closeThread = useShellStore((s) => s.closeThread);
  const openThread = useShellStore((s) => s.openThreadForMessage);

  const { data: thread } = useThreadByRootMessage(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    rootMessageId ?? undefined,
  );

  const threadId = thread?.id;

  const { data: threadMessages } = useThreadMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    threadId ?? undefined,
  );

  const { resolve } = useMemberLookup(workspaceId ?? undefined);
  const toggleReaction = useToggleReactionMutation();

  // Get the root message from the conversation messages cache
  const { data: conversationData } = useConversationMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
  );

  const rootMessage = useMemo(() => {
    if (!conversationData?.pages || !rootMessageId) return null;
    for (const page of conversationData.pages) {
      const found = page.items.find((m) => m.id === rootMessageId);
      if (found) return found;
    }
    return null;
  }, [conversationData?.pages, rootMessageId]);

  const items = threadMessages?.items ?? [];
  const replyCount = items.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new replies arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);

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
        <h3 className="text-sm font-medium text-white">{headerText}</h3>
        <button
          type="button"
          onClick={closeThread}
          className="rounded p-1 text-rim-text-muted transition hover:text-white"
          aria-label="Close thread"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Root message */}
      {rootMessage && (
        <div className="border-b border-rim-line px-4 py-3">
          <MessageItem
            message={rootMessage}
            authorName={resolve(rootMessage.authorId).displayName}
            authorInitial={resolve(rootMessage.authorId).displayName.charAt(0).toUpperCase()}
            isCurrentUser={resolve(rootMessage.authorId).isCurrentUser}
            reactions={rootMessage.reactions}
            onOpenThread={openThread}
            onToggleReaction={handleToggleReaction}
            onContextMenu={handleContextMenu}
            resolveMember={resolve}
          />
        </div>
      )}

      {/* Thread replies — scrollable area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
      >
        {items.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-rim-text-muted">
            Be the first to reply
          </p>
        ) : (
          items.map((msg) => {
            const member = resolve(msg.authorId);
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                authorName={member.displayName}
                authorInitial={member.displayName.charAt(0).toUpperCase()}
                isCurrentUser={member.isCurrentUser}
                reactions={msg.reactions}
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

      {/* Composer — always visible */}
      <ThreadComposer
        workspaceId={workspaceId!}
        conversationId={conversationId!}
        rootMessageId={rootMessageId}
      />
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
        className="flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-white outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
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
