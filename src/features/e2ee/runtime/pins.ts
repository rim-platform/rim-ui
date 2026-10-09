/**
 * What this device pins about encrypted conversations, against a server that changes its
 * answers: a conversation it holds group state for, or ever saw encrypted, stays encrypted here
 * (a server answering `encryptedAt: null` stops sending, never turns it into plaintext), and a
 * direct message stays between the two principals it was first seen with.
 */

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ConversationGroupInfo } from "../api/e2eeApi";
import { e2eeCommands, type GroupView } from "../api/e2eeCommands";
import { useE2eeStore } from "../state/useE2eeStore";
import { conversationMembers } from "./members";
import { e2eeSession, type E2eeSession } from "./session";

/** A plaintext write refused: the conversation is encrypted on this device. */
export class PinnedEncryptedError extends Error {
  constructor() {
    super(
      "This conversation is encrypted on this device, but the server no longer says so. Sending is stopped.",
    );
    this.name = "PinnedEncryptedError";
  }
}

type PinInput = Pick<ConversationGroupInfo, "id" | "conversationType" | "memberIds"> & {
  encryptedAt: string | null;
};

/**
 * A direct message's two principals by the server's member list, when it lists exactly two and
 * one of them is this device's.
 */
export async function directPair(
  session: E2eeSession,
  workspaceId: string,
  conversation: PinInput,
): Promise<string[] | null> {
  if (conversation.conversationType !== ConversationTypeEnum.DIRECT) return null;
  if (new Set(conversation.memberIds).size !== 2) return null;
  const members = await conversationMembers(workspaceId, conversation.memberIds);
  const principals = [...new Set(members.flatMap((m) => (m.principalId ? [m.principalId] : [])))];
  return principals.length === 2 && principals.includes(session.principalId) ? principals : null;
}

/**
 * Pin what this device learns about a conversation the server calls encrypted (or that is pinned
 * already): its `encryptedAt`, and a direct message's two principals on first use. Returns the
 * group as this device sees it.
 */
export async function pinConversation(
  session: E2eeSession,
  workspaceId: string,
  conversation: PinInput,
): Promise<GroupView | null> {
  const [local] = await e2eeCommands.status(session.account, workspaceId, [conversation.id]);
  if (!conversation.encryptedAt && !local?.pinned) return local ?? null;
  const needsDm =
    conversation.conversationType === ConversationTypeEnum.DIRECT && !local?.dmPrincipals;
  const needsAt = Boolean(conversation.encryptedAt) && !local?.pinnedEncryptedAt;
  if (local?.pinned && !needsDm && !needsAt) return local;
  const dm = needsDm ? await directPair(session, workspaceId, conversation) : null;
  const view = await e2eeCommands.pin(
    session.account,
    workspaceId,
    conversation.id,
    conversation.encryptedAt,
    dm,
  );
  useE2eeStore.getState().setGroup(view);
  return view;
}

/**
 * The principals the server puts in a direct message besides the two it is pinned to: its
 * members and its group's pending adds. Empty when the conversation is not a pinned DM.
 */
export function foreignPrincipals(
  dmPrincipals: string[] | null | undefined,
  principals: (string | null | undefined)[],
): string[] {
  if (!dmPrincipals) return [];
  const foreign = principals.filter(
    (p): p is string => typeof p === "string" && !dmPrincipals.includes(p),
  );
  return [...new Set(foreign)].sort();
}

/** Whether this device pinned the conversation as encrypted. */
export async function pinnedEncrypted(
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  if (useE2eeStore.getState().groups[conversationId]?.pinned) return true;
  const session = await e2eeSession();
  if (!session) return false;
  const [view] = await e2eeCommands
    .status(session.account, workspaceId, [conversationId])
    .catch(() => []);
  if (view) useE2eeStore.getState().setGroup(view);
  return Boolean(view?.pinned);
}

/** Refuse a plaintext write (`sendMessage`, a reply, an edit, a forward) into a pinned conversation. */
export async function refusePlaintextIfPinned(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  if (await pinnedEncrypted(workspaceId, conversationId)) throw new PinnedEncryptedError();
}
