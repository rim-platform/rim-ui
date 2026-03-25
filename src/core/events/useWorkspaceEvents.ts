import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { wsClient } from "../graphql/wsClient";
import { logger } from "../logger";
import { queryKeys } from "../query/keys";
import type { WorkspaceEvent, MessageEventData } from "./types";
import type { MessageItem, MessagesPage } from "../../features/messages/api/useMessages";

const WORKSPACE_EVENTS_QUERY = `
  subscription WorkspaceEvents($workspaceId: ID!) {
    workspaceEvents(workspaceId: $workspaceId)
  }
`;

export function useWorkspaceEvents(workspaceId: string | null) {
  const qc = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | null>(null);

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
    serverId: "",
    conversationId: msg.conversation_id,
    threadId: null,
    rootThreadId: null,
    authorId: msg.author_id,
    text: msg.text ?? "",
    hasAttachments: false,
    parentMessageId: null,
    isDeleted: msg.is_deleted,
    sentAt: msg.sent_at,
    reactions: [],
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

          return {
            ...old,
            pages: [
              { ...firstPage, items: [...firstPage.items, cacheMessage] },
              ...old.pages.slice(1),
            ],
          };
        },
      );
      break;
    }

    case "MessageUpdated": {
      const updated = eventMessageToCache(event.message);
      updated.serverId = workspaceId;

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
      break;
    }

    case "MessageDeleted": {
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                m.id === event.message_id ? { ...m, isDeleted: true } : m,
              ),
            })),
          };
        },
      );
      break;
    }

    case "ReactionsUpdated":
      // Reactions include reactedByMe which the event doesn't carry — invalidate
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
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
  }
}
