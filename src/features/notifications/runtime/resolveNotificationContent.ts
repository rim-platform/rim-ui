import type { QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import type { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { findCachedConversation } from "../../conversations/api/useConversation";
import { memberName } from "../../workspaces/api/memberName";
import {
  authorDisplayName,
  notificationConversationLabel,
  type NamedConversation,
} from "../labels";

const NOTIFICATION_DUE_CONTEXT = gql`
  query NotificationDueContext(
    $serverId: ID!
    $conversationId: ID!
    $messageId: ID!
    $withConversation: Boolean!
    $withMessage: Boolean!
  ) {
    conversation(serverId: $serverId, conversationId: $conversationId)
      @include(if: $withConversation) {
      id
      title
      conversationType
      memberIds
    }
    message(serverId: $serverId, conversationId: $conversationId, messageId: $messageId)
      @include(if: $withMessage) {
      id
      authorId
      author {
        id
        username
        displayName
      }
      text
    }
  }
`;

interface CachedMessage {
  id: string;
  authorId?: string;
  author?: { username: string; displayName?: string | null } | null;
  text?: string | null;
}

interface ContextResponse {
  conversation?: {
    id: string;
    title: string | null;
    conversationType: ConversationTypeEnum;
    memberIds: string[];
  } | null;
  message?: CachedMessage | null;
}

export interface NotificationContent {
  title: string;
  authorName: string;
  text: string;
}

function itemsOf(data: unknown): unknown[] {
  if (typeof data !== "object" || data === null) return [];
  const pages = (data as { pages?: unknown }).pages;
  if (Array.isArray(pages)) return pages.flatMap(itemsOf);
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function findIn(data: unknown, messageId: string): CachedMessage | undefined {
  for (const item of itemsOf(data)) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as { id?: unknown; message?: unknown };
    if (candidate.id === messageId && "text" in candidate) return candidate as CachedMessage;
    // Inbox entries nest the message.
    const nested = candidate.message as CachedMessage | null | undefined;
    if (nested && nested.id === messageId) return nested;
  }
  return undefined;
}

/** The message from the timeline, thread or inbox caches, if any of them holds it. */
export function findCachedMessage(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): CachedMessage | undefined {
  const sources = [
    ...qc.getQueriesData({ queryKey: queryKeys.messages(workspaceId, conversationId) }),
    ...qc.getQueriesData({ queryKey: ["threadMessages", workspaceId, conversationId] }),
    ...qc.getQueriesData({ queryKey: ["notifications", workspaceId] }),
  ];
  for (const [, data] of sources) {
    const hit = findIn(data, messageId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Title (the conversation label) and body parts (author, text) for a `NotificationDue`. Reads the
 * caches first; only what they lack is fetched, in one request.
 */
export async function resolveNotificationContent(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): Promise<NotificationContent> {
  let conversation: NamedConversation | undefined = findCachedConversation(
    qc,
    workspaceId,
    conversationId,
  );
  let message = findCachedMessage(qc, workspaceId, conversationId, messageId);

  if (!conversation || !message) {
    try {
      const res = await graphqlClient.request<ContextResponse>(NOTIFICATION_DUE_CONTEXT, {
        serverId: workspaceId,
        conversationId,
        messageId,
        withConversation: !conversation,
        withMessage: !message,
      });
      conversation = conversation ?? res.conversation ?? undefined;
      message = message ?? res.message ?? undefined;
    } catch (err) {
      logger.warn("[RIM:notifications] Could not load the notification's message:", err);
    }
  }

  const resolveName = (userId: string) => memberName(qc, workspaceId, userId) ?? "Someone";
  const currentUserId = useAuthStore.getState().session?.userId;
  const authorName =
    authorDisplayName(message?.author) ??
    (message?.authorId ? resolveName(message.authorId) : "Someone");

  return {
    title: conversation
      ? notificationConversationLabel(conversation, resolveName, currentUserId)
      : "New message",
    authorName,
    text: message?.text ?? "",
  };
}
