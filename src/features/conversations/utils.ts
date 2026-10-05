import { ConversationTypeEnum } from "../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "./types";

type LabelledConversation = Pick<ConversationSummary, "conversationType" | "title">;

/** How a conversation is named in toasts and confirmations: `#name` for channels. */
export function conversationLabel(conversation: LabelledConversation): string {
  if (conversation.conversationType === ConversationTypeEnum.CHANNEL) {
    return `#${conversation.title ?? "channel"}`;
  }
  return conversation.title || "this conversation";
}

/** Channels and groups can be left; DMs cannot. */
export function canLeaveConversation(
  conversation: Pick<ConversationSummary, "conversationType" | "isMember">,
): boolean {
  return conversation.isMember && conversation.conversationType !== ConversationTypeEnum.DIRECT;
}

/** Members can be invited to channels and groups (not DMs) by anyone already in them. */
export function canInviteToConversation(
  conversation: Pick<ConversationSummary, "conversationType" | "isMember" | "isArchived">,
): boolean {
  return (
    conversation.isMember &&
    !conversation.isArchived &&
    conversation.conversationType !== ConversationTypeEnum.DIRECT
  );
}

/** Leaving is irreversible without an invite for private channels and groups: confirm first. */
export function leaveNeedsConfirmation(
  conversation: Pick<ConversationSummary, "conversationType" | "isPrivate">,
): boolean {
  return conversation.conversationType === ConversationTypeEnum.GROUP || conversation.isPrivate;
}
