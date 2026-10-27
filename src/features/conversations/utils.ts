import {
  ConversationTypeEnum,
  PostingPolicy,
  type ServerMemberRoleGql,
} from "../../core/graphql/generated/schema-types";
import { joinNames } from "../e2ee/utils/names";
import { canModerate, isGuest } from "../workspaces/role";
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

/**
 * Whether the viewer may change a channel's topic, as the server decides: an Owner or
 * Moderator, or the creator of a private channel, and never while the channel is archived.
 * False for anything but a channel.
 */
export function canEditChannelTopic(
  conversation: Pick<
    ConversationSummary,
    "conversationType" | "isArchived" | "isPrivate" | "createdBy"
  >,
  viewer: { userId: string | undefined; canModerate: boolean },
): boolean {
  if (conversation.conversationType !== ConversationTypeEnum.CHANNEL) return false;
  if (conversation.isArchived) return false;
  if (viewer.canModerate) return true;
  return (
    conversation.isPrivate &&
    viewer.userId !== undefined &&
    conversation.createdBy === viewer.userId
  );
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

/** Who is asking to add people, as {@link canInviteTo} needs them. */
export interface InviteViewer {
  userId: string | undefined;
  /** The viewer's role in the conversation's workspace; undefined while it loads. */
  role: ServerMemberRoleGql | undefined;
  /** Whether the conversation lives in a direct space, where everyone is a guest. */
  inDirectSpace: boolean;
  /** The server's default workspace, which every account joins; null or undefined when unknown. */
  defaultWorkspaceId: string | null | undefined;
}

/**
 * Whether the viewer may add people to `conversation`, as the server decides: a member of a
 * channel or group that is not archived. In a direct space any member of a group; elsewhere
 * never a guest, and in the server's default workspace a channel only for an Owner or Moderator
 * or the creator of a private channel.
 */
export function canInviteTo(
  conversation: Pick<
    ConversationSummary,
    "serverId" | "conversationType" | "isMember" | "isArchived" | "isPrivate" | "createdBy"
  >,
  viewer: InviteViewer,
): boolean {
  if (!canInviteToConversation(conversation)) return false;
  if (viewer.inDirectSpace) return conversation.conversationType === ConversationTypeEnum.GROUP;
  if (isGuest(viewer.role)) return false;
  if (
    conversation.conversationType === ConversationTypeEnum.CHANNEL &&
    conversation.serverId === viewer.defaultWorkspaceId
  ) {
    return (
      canModerate(viewer.role) ||
      (conversation.isPrivate &&
        viewer.userId !== undefined &&
        conversation.createdBy === viewer.userId)
    );
  }
  return true;
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

/** What a write adds to a conversation, as its channel's posting policy tells them apart. */
export type PostKind = "message" | "thread" | "reaction" | "pin";

/**
 * Whether a channel's posting policy lets the viewer add this kind of write. Under
 * `MODERATORS`, everyone but the Owner and Moderators is kept from messages and pins, and from
 * thread replies and reactions too unless `allowsThreads`.
 *
 * @param canModerate Whether the viewer is the workspace's Owner or a Moderator.
 */
export function postingAllows(
  posting: { policy: PostingPolicy; allowsThreads: boolean },
  canModerate: boolean,
  kind: PostKind,
): boolean {
  if (posting.policy !== PostingPolicy.MODERATORS || canModerate) return true;
  return (kind === "thread" || kind === "reaction") && posting.allowsThreads;
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

/** `count` members as text: "1 member", "3 members". */
export function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? "member" : "members"}`;
}
