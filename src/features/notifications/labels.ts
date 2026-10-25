import { ConversationTypeEnum } from "../../core/graphql/generated/schema-types";
import { untitledGroupName } from "../conversations/utils";

/** What is needed to name a conversation in a notification. */
export interface NamedConversation {
  title?: string | null;
  conversationType: ConversationTypeEnum;
  memberIds: string[];
}

/**
 * How a notification names its conversation: `#name` for channels, the other member for a
 * direct message, and the title (else the members) for a group.
 */
export function notificationConversationLabel(
  conversation: NamedConversation,
  resolveName: (userId: string) => string,
  currentUserId: string | undefined,
): string {
  if (conversation.conversationType === ConversationTypeEnum.CHANNEL) {
    return `#${conversation.title ?? "channel"}`;
  }
  if (conversation.title) return conversation.title;
  return untitledGroupName(conversation, currentUserId, resolveName) ?? "Direct message";
}

/** The author's display name, else username. */
export function authorDisplayName(
  author: { username: string; displayName?: string | null } | null | undefined,
): string | undefined {
  if (!author) return undefined;
  return author.displayName || author.username;
}
