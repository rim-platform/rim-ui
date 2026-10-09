/**
 * The upgrade of an existing DM or group to end-to-end encryption ("Migration"): an eligible
 * member's desktop creates the conversation's first group once every member is ready. In a DM
 * either member is eligible; in a group the creator, or any member when the creator is gone.
 */

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { fetchConversationGroup } from "../api/e2eeApi";
import { createGroup } from "./groups";
import { conversationMembers, notReadyMembers } from "./members";
import type { E2eeSession } from "./session";

/** A conversation as the upgrade needs it. */
export interface UpgradeCandidate {
  id: string;
  conversationType: string;
  memberIds: string[];
  createdBy: string | null;
  encryptedAt: string | null;
}

/** Whether `userId`'s desktop may upgrade the conversation. */
export function upgradeEligible(conversation: UpgradeCandidate, userId: string): boolean {
  const { conversationType, createdBy, memberIds } = conversation;
  if (conversationType === ConversationTypeEnum.DIRECT) return true;
  if (conversationType !== ConversationTypeEnum.GROUP) return false;
  return createdBy === userId || !createdBy || !memberIds.includes(createdBy);
}

/**
 * Upgrade `conversation` when it is a plaintext DM or group, this device's user is eligible
 * and every member is ready. `checked` hears who is not ready before the upgrade starts and
 * may stop it by answering false. Returns the names of the members who are not ready yet.
 */
export async function upgradeIfReady(
  session: E2eeSession,
  workspaceId: string,
  conversation: UpgradeCandidate,
  checked: (notReady: string[]) => boolean = () => true,
): Promise<string[]> {
  if (conversation.encryptedAt) return [];
  const members = await conversationMembers(workspaceId, conversation.memberIds);
  const { names } = await notReadyMembers(members);
  if (!checked(names)) return names;
  if (names.length === 0 && upgradeEligible(conversation, session.userId)) {
    await createGroup(session, workspaceId, conversation.id);
  }
  return names;
}

/** {@link upgradeIfReady} for a conversation known only by id, such as one just created. */
export async function upgradeNewConversation(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
): Promise<string[]> {
  const info = await fetchConversationGroup(workspaceId, conversationId);
  return upgradeIfReady(session, workspaceId, info);
}
