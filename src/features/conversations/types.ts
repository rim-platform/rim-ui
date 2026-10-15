import type { Conversation } from "../../core/graphql/generated/schema-types";

/** A conversation as selected by the shared `ConversationFields` fragment. */
export type ConversationSummary = Pick<
  Conversation,
  | "id"
  | "serverId"
  | "title"
  | "conversationType"
  | "memberIds"
  | "topic"
  | "isPrivate"
  | "isArchived"
  | "archivedAt"
  | "memberCount"
  | "isMember"
  | "createdBy"
  | "slowModeSeconds"
  | "notificationLevel"
  | "effectiveNotificationLevel"
  | "encryptedAt"
  | "pendingMemberIds"
>;

/** A page of conversations, as returned by `channels` and `inboxConversations`. */
export interface ConversationSummaryPage {
  items: ConversationSummary[];
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}
