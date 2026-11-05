import type { QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { findCachedConversation } from "../../conversations/api/useConversation";
import { plainMessagePreview } from "../../messages/utils/snippetText";
import { mentionedMemberName } from "../../workspaces/api/memberName";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { buildMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useKnownHandles } from "../../workspaces/state/useKnownHandles";
import { useContactStore } from "../../relay/contacts/useContactStore";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { ENCRYPTED_MESSAGE_TEXT, storedTextSoon } from "../api/storedText";
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
      threadId
      authorId
      author {
        id
        username
        displayName
      }
      text
      encryption {
        sentAtUs
      }
    }
  }
`;

interface CachedMessage {
  id: string;
  threadId?: string | null;
  authorId?: string;
  author?: { username: string; displayName?: string | null } | null;
  text?: string | null;
  encryption?: { sentAtUs: string } | null;
  /** Set on an encrypted message read from this device's store. */
  e2ee?: unknown;
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
  /** Whether the message is end-to-end encrypted. */
  encrypted: boolean;
  /** The thread the message is a reply in; null for any other message, or one not loaded. */
  threadId: string | null;
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
 * Title (the conversation label), body parts (author, text) and thread for a `NotificationDue`, the
 * text as plain text with its mentions named. Reads the caches first; only what they lack is fetched,
 * in one request.
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

  // The member list is needed only when a name is: an untitled non-channel conversation, or an
  // author the message does not carry.
  const namesMembers =
    (conversation !== undefined &&
      conversation.conversationType !== ConversationTypeEnum.CHANNEL &&
      !conversation.title) ||
    (!message?.author && Boolean(message?.authorId));
  const membersKey = queryKeys.serverMembers(workspaceId);
  const members: ServerMember[] | undefined = namesMembers
    ? await qc
        .ensureQueryData({
          queryKey: membersKey,
          queryFn: () => fetchServerMembers(workspaceId),
          staleTime: 60_000,
        })
        .catch(() => undefined)
    : qc.getQueryData<ServerMember[]>(membersKey);
  const lookup = buildMemberLookup({
    me: qc.getQueryData(queryKeys.me),
    members,
    aliases: useContactStore.getState().aliases,
    handles: useKnownHandles.getState().byUser,
    inDirectSpace: isDirectSpace(workspaceId),
  });
  const resolveName = (userId: string) => lookup.resolve(userId).displayName || "Someone";
  const currentUserId = useAuthStore.getState().session?.userId;
  const authorName =
    authorDisplayName(message?.author) ??
    (message?.authorId ? resolveName(message.authorId) : "Someone");

  let text = message?.text ?? "";
  // The server holds no text for an encrypted message: this device's store does once the sync
  // that the same message's event started has decrypted it.
  if (message?.encryption && !message.text) {
    text = (await storedTextSoon(message.id)) ?? ENCRYPTED_MESSAGE_TEXT;
  }

  return {
    title: conversation
      ? notificationConversationLabel(conversation, resolveName, currentUserId)
      : "New message",
    authorName,
    text: plainMessagePreview(text, (id) => mentionedMemberName(qc, workspaceId, id)),
    encrypted: Boolean(message?.encryption || message?.e2ee),
    threadId: message?.threadId ?? null,
  };
}
