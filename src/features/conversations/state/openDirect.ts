import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { directSpaceIdsOf, supersededConversations } from "../../relay/api/useDirectInbox";
import type { PredecessorView } from "../../relay/api/relayApi";
import { useRelayStore } from "../../relay/state/useRelayStore";
import type { DirectMember } from "../../relay/conversations/startDirect";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { inboxQueryOptions } from "../api/useInboxConversations";
import type { ConversationSummary } from "../types";
import { pendingMembersOf } from "../utils";
import { selectDirectConversation } from "./directSelection";

/** Everyone a conversation holds: its members and those invited. */
function peopleOf(conversation: ConversationSummary): string[] {
  return [...conversation.memberIds, ...pendingMembersOf(conversation)];
}

async function inboxOf(spaceId: string): Promise<ConversationSummary[]> {
  return (await queryClient.ensureQueryData(inboxQueryOptions(spaceId))).items;
}

/** The workspace DM whose people are exactly the viewer and `otherUserId`. */
async function workspaceDirect(
  workspaceId: string,
  otherUserId: string,
): Promise<ConversationSummary | undefined> {
  const me = useAuthStore.getState().session?.userId;
  const pair = new Set([me, otherUserId]);
  return (await inboxOf(workspaceId)).find((c) => {
    if (c.conversationType !== ConversationTypeEnum.DIRECT) return false;
    const people = new Set(peopleOf(c));
    return people.size === pair.size && [...pair].every((id) => id && people.has(id));
  });
}

/** The DM with `principalId` in the direct spaces this account uses, as the side rail lists them. */
async function spaceDirect(principalId: string): Promise<ConversationSummary | undefined> {
  const { info, spaces, forked } = useRelayStore.getState();
  const spaceIds = directSpaceIdsOf(info?.directSpaceId ?? null, spaces, forked);
  const items = (await Promise.all(spaceIds.map(inboxOf))).flat();
  const predecessors = new Map<string, PredecessorView>();
  for (const item of items) {
    const view = queryClient.getQueryData<PredecessorView>([
      "conversationPredecessor",
      item.serverId,
      item.id,
    ]);
    if (view) predecessors.set(item.id, view);
  }
  const { hidden } = supersededConversations(
    items,
    predecessors,
    (spaceId) => spaces[spaceId]?.hostServerId ?? null,
    info?.serverId ?? null,
  );
  for (const item of items) {
    if (hidden.has(item.id) || item.conversationType !== ConversationTypeEnum.DIRECT) continue;
    const members = await queryClient.ensureQueryData({
      queryKey: queryKeys.serverMembers(item.serverId),
      queryFn: () => fetchServerMembers(item.serverId),
    });
    const people = new Set(peopleOf(item));
    if (members.some((m) => people.has(m.userId) && m.principalId === principalId)) return item;
  }
  return undefined;
}

/**
 * Opens the direct message with one person: the one this client has loaded, else a draft
 * whose first message creates it (also when the list cannot be read). A draft in a direct
 * space switches to that space first.
 */
export async function openDirectWith(target: DirectDraft): Promise<void> {
  useShellStore.getState().setActivePanel("inbox");
  if ("spaceId" in target) {
    const existing = await spaceDirect(target.member.principalId).catch(() => undefined);
    if (existing) {
      selectDirectConversation(existing.serverId, existing.id);
      return;
    }
    if (useWorkspaceStore.getState().workspaceId !== target.spaceId) {
      useWorkspaceStore.getState().setWorkspaceId(target.spaceId);
    }
    useShellStore.getState().openDraftDirect(target);
    return;
  }
  const existing = await workspaceDirect(target.workspaceId, target.otherUserId).catch(
    () => undefined,
  );
  if (existing) useShellStore.getState().setSelectedConversationId(existing.id);
  else useShellStore.getState().openDraftDirect(target);
}

/** The key a draft direct message keeps its unsent text under; never a conversation id. */
export function directDraftKey(draft: DirectDraft): string {
  return "spaceId" in draft
    ? `draft-dm:${draft.spaceId}:${draft.member.principalId}`
    : `draft-dm:${draft.workspaceId}:${draft.otherUserId}`;
}

/**
 * The members of a workspace selection as principals, when every one of them has a principal
 * id (by the member list last seen): then a conversation with them starts in this relay's
 * direct space instead of the workspace.
 */
export function principalsOf(workspaceId: string, userIds: string[]): DirectMember[] | null {
  const members =
    queryClient.getQueryData<ServerMember[]>(queryKeys.serverMembers(workspaceId)) ?? [];
  const picked = userIds.map((id) => members.find((m) => m.userId === id));
  if (picked.some((m) => !m?.principalId)) return null;
  return (picked as ServerMember[]).map((m) => ({
    principalId: m.principalId!,
    relayUrls: [],
    name: m.displayName || m.username,
  }));
}

/**
 * Opens the direct message with a member of the open workspace, as the new-message picker
 * does for one person: in this relay's direct space when they have a principal id, else in
 * the workspace.
 */
export async function openDirectWithMember(userId: string): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return;
  const spaceId = useRelayStore.getState().info?.directSpaceId;
  const member = spaceId ? principalsOf(workspaceId, [userId])?.[0] : undefined;
  if (spaceId && member) await openDirectWith({ spaceId, member });
  else await openDirectWith({ workspaceId, otherUserId: userId });
}
