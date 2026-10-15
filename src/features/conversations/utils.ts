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

/**
 * Who is invited to an encrypted conversation and waits for a device set up for encryption.
 * Empty when the list came from a copy saved before the server reported invitations.
 */
export function pendingMembersOf(conversation: Pick<ConversationSummary, "pendingMemberIds">) {
  return conversation.pendingMemberIds ?? [];
}

/** Whether `userId` holds an invitation to the conversation rather than its membership. */
export function isInvited(
  conversation: Pick<ConversationSummary, "pendingMemberIds">,
  userId: string | null | undefined,
): boolean {
  return userId ? pendingMembersOf(conversation).includes(userId) : false;
}

/** The person a DM is with: its other member, or the one invited and not joined yet. */
export function directPeerId(
  conversation: Pick<ConversationSummary, "memberIds" | "pendingMemberIds">,
  userId: string | null | undefined,
): string | undefined {
  const people = [...conversation.memberIds, ...pendingMembersOf(conversation)];
  return people.find((id) => id !== userId) ?? people[0];
}
