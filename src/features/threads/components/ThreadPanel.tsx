import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import { Send, X } from "lucide-react";

import { activeBan, useBanExpiry } from "../../messages/hooks/useBanExpiry";
import { useThreadByRootMessage, useThreadMessages } from "../api/useThreads";
import { useReplyToMessageMutation } from "../api/useReplyToMessage";
import { useConversationMessages } from "../../messages/api/useMessages";
import { useToggleReactionMutation } from "../../messages/api/useToggleReaction";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { replaceShortcodes } from "../../messages/utils/emojiShortcodes";
import { MessageItem } from "../../messages/components/MessageItem";
import type { MessageItemHandlers } from "../../messages/components/MessageItem";
import { ForwardDialog } from "../../messages/components/ForwardDialog";
import { useMessageContextMenu } from "../../messages/hooks/useMessageContextMenu";
import { usePostingRights } from "../../conversations/api/useChannelPosting";
import { PostingRestrictedBar } from "../../conversations/components/PostingRestrictedBar";
import type { MessageItem as MessageItemData } from "../../../core/types/messages";
import { usePinnedMessages } from "../../messages/api/usePinnedMessages";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { logger } from "../../../core/logger";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useEncryptedHere, usePrincipalNames } from "../../e2ee/hooks/useE2eeConversation";
import { invalidateTimeline } from "../../e2ee/runtime/groups";
import { EncryptedSendError, sendEncrypted } from "../../e2ee/runtime/send";
import { toPrincipalMentions, toUserMentions } from "../../e2ee/utils/content";
import { withSenderAsAuthor } from "../../e2ee/utils/timeline";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useUserContextMenu } from "../../workspaces/hooks/useUserContextMenu";
import { useOwnHandleDomain } from "../../workspaces/api/useCurrentUser";
import { rememberHandles } from "../../workspaces/state/useKnownHandles";
import { personName, viewHandle } from "../../../shared/utils/handles";

/** A message the thread panel shows: the root or a reply. */
type ThreadPanelMessage = { id: string; authorId: string };

/**
 * The message as the report dialog takes it. The replies of an encrypted conversation come
 * from this device's cache and carry their `e2ee`; the dialog reports any other as plaintext.
 */
function reportable(message: ThreadPanelMessage | undefined): MessageItemData | undefined {
  return message && "e2ee" in message ? (message as MessageItemData) : undefined;
}

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
  const encrypted = useEncryptedHere(workspaceId, conversationId);
  const { userOf } = usePrincipalNames(workspaceId);

  const threadMsgs = useThreadMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    threadId ?? undefined,
    encrypted,
  );
  const threadMessages = threadMsgs.data;

  // Debug: trace the entire data chain (only when values change)
  useEffect(() => {
    logger.debug("[ThreadPanel] rootMessageId:", rootMessageId);
    logger.debug(
      "[ThreadPanel] threadByRoot:",
      thread,
      "status:",
      threadByRoot.status,
      "error:",
      threadByRoot.error,
    );
    logger.debug("[ThreadPanel] threadId:", threadId);
    logger.debug(
      "[ThreadPanel] threadMessages enabled:",
      Boolean(workspaceId && conversationId && threadId),
    );
    logger.debug(
      "[ThreadPanel] threadMessages data:",
      threadMessages,
      "status:",
      threadMsgs.status,
      "error:",
      threadMsgs.error,
    );
    logger.debug("[ThreadPanel] threadMessages items:", threadMessages?.items?.length);
  }, [
    rootMessageId,
    thread,
    threadByRoot.status,
    threadByRoot.error,
    threadId,
    workspaceId,
    conversationId,
    threadMessages,
    threadMsgs.status,
    threadMsgs.error,
  ]);

  const currentUserId = useAuthStore((s) => s.session?.userId);
  const toggleReaction = useToggleReactionMutation();
  const rights = usePostingRights(workspaceId, conversationId);

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
        if (found && encrypted) {
          const shown = withSenderAsAuthor(found, userOf);
          return found.text ? { ...shown, text: toUserMentions(found.text, userOf) } : shown;
        }
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
  }, [conversationData, rootMessageId, thread, encrypted, userOf]);

  // Backend returns thread messages in display order (oldest-first); no reverse needed.
  // Decrypted replies name mentioned principals; the renderer names users.
  useBanExpiry(workspaceId, [
    rootMessage?.author,
    ...(threadMessages?.items ?? []).map((message) => message.author),
  ]);
  const items = useMemo(() => {
    const replies = threadMessages?.items ?? [];
    if (!encrypted) return replies;
    return replies.map((reply) => {
      const m = withSenderAsAuthor(reply, userOf);
      return m.text ? { ...m, text: toUserMentions(m.text, userOf) } : m;
    });
  }, [threadMessages?.items, encrypted, userOf]);
  const replyCount = items.length;
  const ownDomain = useOwnHandleDomain();
  useEffect(
    () => rememberHandles([rootMessage?.author, ...items.map((m) => m.author)]),
    [rootMessage, items],
  );

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
    if (!/^[\w-]+$/.test(highlightedMessageId)) {
      setHighlightedMessageId(null);
      return;
    }

    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-message-id="${highlightedMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bg-rim-accent/10");
        setTimeout(() => el.classList.remove("bg-rim-accent/10"), 1500);
      }
      setHighlightedMessageId(null);
    }, 300);

    return () => clearTimeout(timer);
  }, [highlightedMessageId, setHighlightedMessageId, items]);

  const toggleReactionMutate = toggleReaction.mutate;
  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!workspaceId || !conversationId) return;
      toggleReactionMutate({
        serverId: workspaceId,
        conversationId,
        messageId,
        emoji,
      });
    },
    [workspaceId, conversationId, toggleReactionMutate],
  );

  const [forwardMessage, setForwardMessage] = useState<{ id: string; text: string } | null>(null);
  const forward = useCallback((id: string, text: string) => setForwardMessage({ id, text }), []);
  const messageMenu = useMessageContextMenu({
    workspaceId,
    conversationId,
    onForward: forward,
    threadId: threadId ?? null,
  });
  const contextMenu = useContextMenu();
  const { openFromEvent, bind } = contextMenu;

  // The handlers stay stable for the rows' memo; the messages and the menu's items are read
  // through refs when a menu opens.
  const { data: pinnedMessages } = usePinnedMessages(
    workspaceId ?? undefined,
    conversationId ?? undefined,
  );
  const messagesRef = useRef<ThreadPanelMessage[]>([]);
  const pinnedRef = useRef(pinnedMessages);
  const getMenuItemsRef = useRef(messageMenu.getItems);
  useLayoutEffect(() => {
    messagesRef.current = rootMessage ? [rootMessage, ...items] : items;
    pinnedRef.current = pinnedMessages;
    getMenuItemsRef.current = messageMenu.getItems;
  }, [rootMessage, items, pinnedMessages, messageMenu.getItems]);

  const menuItemsFor = useCallback(
    (messageId: string, messageText: string) => () => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      return getMenuItemsRef.current({
        messageId,
        messageText,
        isOwnMessage: currentUserId !== undefined && message?.authorId === currentUserId,
        isPinned: pinnedRef.current?.some((m) => m.id === messageId) ?? false,
        hasThread: true,
        message: reportable(message),
      });
    },
    [currentUserId],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, messageId: string, messageText: string) => {
      openFromEvent(event, menuItemsFor(messageId, messageText));
    },
    [openFromEvent, menuItemsFor],
  );

  const bindContextMenu = useCallback(
    (messageId: string, messageText: string) => bind(menuItemsFor(messageId, messageText)),
    [bind, menuItemsFor],
  );

  // A person's name, avatar or mention opens their menu, which wins over the message's.
  const userMenu = useUserContextMenu({ workspaceId });
  const { bind: bindUserContextMenu, openFrom: openUserMenu } = userMenu;
  const onMentionContextMenu = useCallback(
    (userId: string, mention: Element, event: React.MouseEvent | React.KeyboardEvent) => {
      openUserMenu(event, { userId }, mention);
    },
    [openUserMenu],
  );

  const handlers = useMemo<MessageItemHandlers>(
    () => ({
      onOpenThread: openThread,
      onToggleReaction: handleToggleReaction,
      canAddReaction: rights.reaction,
      onContextMenu: handleContextMenu,
      bindContextMenu,
      bindUserContextMenu,
      onMentionContextMenu,
    }),
    [
      openThread,
      handleToggleReaction,
      rights.reaction,
      handleContextMenu,
      bindContextMenu,
      bindUserContextMenu,
      onMentionContextMenu,
    ],
  );
  if (!rootMessageId) return null;

  const headerText = !thread
    ? "Thread"
    : replyCount === 0
      ? "Thread"
      : `Thread \u2014 ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;

  return (
    <div
      data-panel="threadPane"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("threadPane")}
      className="flex h-full flex-col rounded-xl border border-rim-line bg-rim-panel outline-none"
    >
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
      {rootMessage &&
        (() => {
          const name = personName(rootMessage.author, rootMessage.authorId, ownDomain);
          return (
            <div className="border-b border-rim-line px-4 py-3">
              <MessageItem
                view={{
                  message: rootMessage,
                  author: {
                    name,
                    ban: {
                      banned: activeBan(rootMessage.author),
                      bannedUntil: rootMessage.author?.bannedUntil,
                      banReason: rootMessage.author?.banReason,
                    },
                    avatarUrl: rootMessage.author?.avatarUrl,
                    username: rootMessage.author?.username,
                    handle: viewHandle(
                      rootMessage.author?.username,
                      rootMessage.author?.handle,
                      ownDomain,
                    ),
                    isCurrentUser:
                      currentUserId !== undefined && rootMessage.authorId === currentUserId,
                  },
                }}
                handlers={handlers}
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
            const name = personName(msg.author, msg.authorId, ownDomain);
            return (
              <MessageItem
                key={msg.id}
                view={{
                  message: msg,
                  author: {
                    name,
                    ban: {
                      banned: activeBan(msg.author),
                      bannedUntil: msg.author?.bannedUntil,
                      banReason: msg.author?.banReason,
                    },
                    avatarUrl: msg.author?.avatarUrl,
                    username: msg.author?.username,
                    handle: viewHandle(msg.author?.username, msg.author?.handle, ownDomain),
                    isCurrentUser: currentUserId !== undefined && msg.authorId === currentUserId,
                  },
                }}
                handlers={handlers}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      {contextMenu.menu}
      {userMenu.element}
      {messageMenu.dialog}
      {forwardMessage && workspaceId && conversationId && (
        <ForwardDialog
          open
          onClose={() => setForwardMessage(null)}
          messageId={forwardMessage.id}
          messageText={forwardMessage.text}
          workspaceId={workspaceId}
          sourceConversationId={conversationId}
        />
      )}

      {/* Composer, or the bar that replaces it where the channel keeps the viewer from replying */}
      {workspaceId && conversationId && !rights.thread && <PostingRestrictedBar thread />}
      {workspaceId && conversationId && rights.thread && (
        <ThreadComposer
          workspaceId={workspaceId}
          conversationId={conversationId}
          rootMessageId={rootMessageId}
          threadId={threadId ?? null}
          encrypted={encrypted}
        />
      )}
    </div>
  );
}

function ThreadComposer({
  workspaceId,
  conversationId,
  rootMessageId,
  threadId,
  encrypted,
}: {
  workspaceId: string;
  conversationId: string;
  rootMessageId: string;
  threadId: string | null;
  encrypted: boolean;
}) {
  const [text, setText] = useState("");
  const [sendingEncrypted, setSendingEncrypted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyToMessage = useReplyToMessageMutation();
  const { data: serverMembers } = useServerMembers(workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);

  /** A thread reply in an encrypted conversation: an encrypted message naming its root. */
  async function replyEncrypted(processed: string) {
    const members = serverMembers ?? [];
    const me = members.find((m) => m.userId === currentUserId);
    const principalOf = (userId: string) => members.find((m) => m.userId === userId)?.principalId;
    setSendingEncrypted(true);
    try {
      await sendEncrypted(workspaceId, conversationId, {
        body: toPrincipalMentions(processed, new Map(), principalOf),
        threadRootId: rootMessageId,
        threadId,
        author: {
          id: currentUserId ?? "",
          username: me?.username ?? "",
          displayName: me?.displayName ?? null,
          avatarUrl: me?.avatarUrl ?? null,
          principalId: me?.principalId ?? null,
        },
      });
      setText("");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.threadByRoot(workspaceId, conversationId, rootMessageId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["threadMessages", workspaceId, conversationId],
      });
      invalidateTimeline(workspaceId, conversationId);
    } catch (err) {
      toast.error(err instanceof EncryptedSendError ? err.message : "Failed to send the reply");
    } finally {
      setSendingEncrypted(false);
      textareaRef.current?.focus();
    }
  }

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const processed = replaceShortcodes(trimmed);
    if (encrypted) {
      void replyEncrypted(processed);
      return;
    }

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
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-rim-line px-4 py-3"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Reply in thread..."
        aria-label="Reply in thread"
        className="flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        style={{ height: "auto" }}
      />
      <button
        type="submit"
        disabled={replyToMessage.isPending || sendingEncrypted || !text.trim()}
        className="rounded-lg bg-rim-accent p-2 text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
        aria-label="Send reply"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
