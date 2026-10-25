import { ConversationTypeEnum } from "../../core/graphql/generated/schema-types";
import { joinNames } from "../e2ee/utils/names";
import type { ConversationSummary } from "./types";

type LabelledConversation = Pick<ConversationSummary, "conversationType" | "title">;

/** How a conversation is named in toasts and confirmations: `#name` for channels. */
export function conversationLabel(conversation: LabelledConversation): string {
  if (conversation.conversationType === ConversationTypeEnum.CHANNEL) {
    return `#${conversation.title ?? "channel"}`;
  }
  return conversation.title || "this conversation";
}

/** How many people an untitled group's name lists before counting the rest. */
const GROUP_NAMES_SHOWN = 3;

/**
 * The name of a group without a title, from the names of everyone in it but the viewer: members,
 * then those invited. Sorted, so every list names a group alike.
 *
 * @param resolveName - A person's name as the viewer sees it.
 * @returns "Ana", "Ana and Bo", "Ana, Bo and Cy", or "Ana, Bo, Cy and 2 others" past three;
 * `null` when nobody else is in the group.
 */
export function untitledGroupName(
  conversation: Pick<ConversationSummary, "memberIds"> &
    Partial<Pick<ConversationSummary, "pendingMemberIds">>,
  userId: string | null | undefined,
  resolveName: (userId: string) => string,
): string | null {
  const people = [
    ...new Set([...conversation.memberIds, ...(conversation.pendingMemberIds ?? [])]),
  ];
  const names = people
    .filter((id) => id !== userId)
    .map(resolveName)
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  if (names.length <= GROUP_NAMES_SHOWN) return joinNames(names);
  const rest = names.length - GROUP_NAMES_SHOWN;
  return `${names.slice(0, GROUP_NAMES_SHOWN).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
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

/**
 * The row of `conversationId` among the conversation rows inside `container`.
 *
 * @returns The row's element, or `null` when it is not rendered.
 */
export function conversationRowIn(container: Element, conversationId: string): HTMLElement | null {
  const rows = container.querySelectorAll<HTMLElement>("[data-conversation-id]");
  return Array.from(rows).find((row) => row.dataset.conversationId === conversationId) ?? null;
}
