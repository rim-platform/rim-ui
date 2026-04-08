import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { wsClient, onWsConnected } from "../graphql/wsClient";
import { logger } from "../logger";
import { toast } from "../../shared/toast";
import { queryKeys } from "../query/keys";
import type { WorkspaceEvent, MessageEventData } from "./types";
import type { MessageItem, MessagesPage } from "../types/messages";
import { eventBus } from "./eventBus";
import { BUS_EVENTS } from "./busEvents";
import type {
  UnreadIncrementEvent,
  UnreadMarkReadEvent,
  PresenceChangedEvent,
  TypingStartedEvent,
  NewMessageNotificationEvent,
} from "./busEvents";

const WORKSPACE_EVENTS_QUERY = `
  subscription WorkspaceEvents($workspaceId: ID!) {
    workspaceEvents(workspaceId: $workspaceId)
  }
`;

export function useWorkspaceEvents(workspaceId: string | null) {
  const qc = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Invalidate all queries on WebSocket reconnect to catch up on missed events
  useEffect(() => {
    const unsubscribe = onWsConnected(() => {
      logger.debug("[RIM:WS] Reconnected — invalidating all queries");
      qc.invalidateQueries();
      toast.success("Reconnected", { id: "ws-reconnect", description: "Real-time connection restored." });
    });
    return unsubscribe;
  }, [qc]);

  useEffect(() => {
    if (!workspaceId) return;

    logger.debug("[RIM:WS] Subscribing to workspace events for:", workspaceId);

    // Clean up previous subscription
    unsubscribeRef.current?.();

    const cleanup = wsClient.subscribe<{ workspaceEvents: string }>(
      {
        query: WORKSPACE_EVENTS_QUERY,
        variables: { workspaceId },
      },
      {
        next: (result) => {
          if (!result.data?.workspaceEvents) return;

          try {
            const event: WorkspaceEvent = JSON.parse(result.data.workspaceEvents);
            handleEvent(event, qc, workspaceId);
          } catch (err) {
            logger.warn("[RIM:WS] Failed to parse event:", err);
          }
        },
        error: (err) => {
          logger.error("[RIM:WS] Subscription error:", err);
        },
        complete: () => {
          logger.debug("[RIM:WS] Subscription completed");
        },
      },
    );

    unsubscribeRef.current = cleanup;

    return () => {
      cleanup();
      unsubscribeRef.current = null;
    };
  }, [workspaceId, qc]);
}

function eventMessageToCache(msg: MessageEventData): MessageItem {
  return {
    id: msg.id,
    serverId: msg.server_id,
    conversationId: msg.conversation_id,
    threadId: msg.thread_id ?? null,
    rootThreadId: msg.root_thread_id ?? null,
    authorId: msg.author_id,
    author: null,
    text: msg.text ?? "",
    hasAttachments: msg.has_attachments ?? false,
    parentMessageId: msg.parent_message_id ?? null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: msg.is_deleted,
    sentAt: msg.sent_at,
    reactions: [],
    attachments: [],
    linkPreviews: [],
  };
}

function handleEvent(
  event: WorkspaceEvent,
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  switch (event.type) {
    case "NewMessage": {
      const cacheMessage = eventMessageToCache(event.message);
      cacheMessage.serverId = workspaceId;

      if (event.message.thread_id) {
        // Thread reply — invalidate thread messages and thread metadata
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(workspaceId, event.conversation_id, event.message.thread_id),
        });
        // Invalidate threadByRoot so reply count / lastMessageAt updates
        qc.invalidateQueries({
          queryKey: ["threadByRoot", workspaceId, event.conversation_id],
        });
      } else {
        // Main conversation message — update cache directly
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0];
            if (!firstPage) return old;

            // Deduplicate — skip if message already exists
            const exists = old.pages.some((p) =>
              p.items.some((m) => m.id === cacheMessage.id),
            );
            if (exists) return old;

            // Items are now oldest-first, so append new message at the end
            return {
              ...old,
              pages: [
                { ...firstPage, items: [...firstPage.items, cacheMessage] },
                ...old.pages.slice(1),
              ],
            };
          },
        );
      }

      // Unread tracking + desktop notifications via event bus
      // Features decide filtering (own message, active conversation, muted, etc.)
      eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
      });

      eventBus.emit<NewMessageNotificationEvent>(BUS_EVENTS.NEW_MESSAGE_NOTIFICATION, {
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
        messageText: event.message.text ?? "",
      });
      break;
    }

    case "MessageUpdated": {
      const updated = eventMessageToCache(event.message);
      updated.serverId = workspaceId;

      if (event.message.thread_id) {
        // Thread message — invalidate thread queries
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(workspaceId, event.conversation_id, event.message.thread_id),
        });
      } else {
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((m) => {
                  if (m.id !== updated.id) return m;
                  // Preserve fields the event doesn't carry
                  return {
                    ...m,
                    text: updated.text,
                    isDeleted: updated.isDeleted,
                    sentAt: updated.sentAt,
                  };
                }),
              })),
            };
          },
        );
      }
      break;
    }

    case "MessageDeleted": {
      if (event.thread_id) {
        // Thread message — invalidate thread queries
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(workspaceId, event.conversation_id, event.thread_id),
        });
        qc.invalidateQueries({
          queryKey: ["threadByRoot", workspaceId, event.conversation_id],
        });
      } else {
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((m) =>
                  m.id === event.message_id ? { ...m, isDeleted: true, text: "" } : m,
                ),
              })),
            };
          },
        );
      }
      break;
    }

    case "ReactionsUpdated":
      // Update reactions in-place for the specific message.
      // The event doesn't carry reactedByMe, so preserve the old value.
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) => {
                if (m.id !== event.message_id) return m;
                const updatedReactions = event.reactions.map((r) => {
                  const existing = m.reactions.find((er) => er.emoji === r.emoji);
                  return {
                    emoji: r.emoji,
                    count: r.count,
                    reactedByMe: existing?.reactedByMe ?? false,
                    userIds: existing?.userIds ?? [],
                  };
                });
                return { ...m, reactions: updatedReactions };
              }),
            })),
          };
        },
      );
      // Also mark as stale so reactedByMe gets refreshed on next focus
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
        refetchType: "none",
      });
      break;

    case "ConversationCreated":
      // Invalidate both channel and conversation lists
      qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
      break;

    case "MemberJoined":
      // Invalidate member list
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
      break;

    case "ThreadCreated":
      // Invalidate conversation messages so root message gets updated with rootThreadId
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      // Invalidate thread lookup for the root message
      qc.invalidateQueries({
        queryKey: queryKeys.threadByRoot(workspaceId, event.conversation_id, event.root_message_id),
      });
      break;

    case "ReadStateUpdated":
      // Multi-device sync — another client marked conversation as read
      eventBus.emit<UnreadMarkReadEvent>(BUS_EVENTS.UNREAD_MARK_READ, {
        conversationId: event.conversation_id,
      });
      break;

    case "PresenceChanged": {
      eventBus.emit<PresenceChangedEvent>(BUS_EVENTS.PRESENCE_CHANGED, {
        userId: event.user_id,
        status: event.status,
      });
      break;
    }

    case "MemberAddedToConversation":
    case "MemberRemovedFromConversation":
      qc.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
      break;

    case "TypingStarted": {
      eventBus.emit<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, {
        conversationId: event.conversation_id,
        userId: event.user_id,
        username: event.username,
      });
      break;
    }

    case "UserMentioned": {
      const channelName = resolveConversationName(qc, workspaceId, event.conversation_id);
      toast.info(`You were mentioned in #${channelName}`);
      break;
    }

    case "LinkPreviewReady":
      // Backend finished fetching link preview metadata — refresh the message
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      break;

    case "MessagePinned":
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                m.id === event.message_id ? { ...m, isPinned: true } : m,
              ),
            })),
          };
        },
      );
      qc.invalidateQueries({ queryKey: queryKeys.pinnedMessages(workspaceId, event.conversation_id) });
      break;

    case "MessageUnpinned":
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                m.id === event.message_id ? { ...m, isPinned: false } : m,
              ),
            })),
          };
        },
      );
      qc.invalidateQueries({ queryKey: queryKeys.pinnedMessages(workspaceId, event.conversation_id) });
      break;
  }
}

interface ConversationCachePage {
  items: { id: string; title: string; conversationType: string }[];
}

function resolveConversationName(qc: ReturnType<typeof useQueryClient>, workspaceId: string, conversationId: string): string {
  const channels = qc.getQueryData<ConversationCachePage>(queryKeys.channels(workspaceId));
  const inbox = qc.getQueryData<ConversationCachePage>(queryKeys.conversations(workspaceId));
  const all = [...(channels?.items ?? []), ...(inbox?.items ?? [])];
  const conv = all.find((c) => c.id === conversationId);
  return conv?.title || "New message";
}
