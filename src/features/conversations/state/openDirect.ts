import { asSentence } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { blockedPrincipalIds } from "../../relay/inbox/blockedCreators";
import { directSpaceIdsOf, supersededConversations } from "../../relay/api/useDirectInbox";
import type { PredecessorView } from "../../relay/api/relayApi";
import { useRelayStore } from "../../relay/state/useRelayStore";
import type { DirectMember } from "../../relay/conversations/startDirect";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { inboxQueryOptions } from "../api/useInboxConversations";
import type { ConversationSummary } from "../types";
import { pendingMembersOf } from "../utils";
import { rememberDirectOrigin } from "./directOrigin";
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

/** How many {@link openDirectWith} calls are still finding the conversation to open. */
let opening = 0;
/** Text typed outside any field while the conversation to open is still being found. */
let typedWhileOpening = "";
/** How long typing waits for the opened conversation's composer, in milliseconds. */
const AWAIT_COMPOSER_MS = 3000;
/** The draft key of the conversation just opened, until its composer is drawn, and until when. */
let awaitedComposer: { key: string; until: number } | null = null;

/** Whether a direct message is being opened: the app is about to leave the open conversation. */
export function directOpening(): boolean {
  return opening > 0;
}

/**
 * Takes a character typed outside any text field while a direct message opens, or after it
 * opened and before its composer is drawn, so it lands in that conversation's composer and not
 * in the one being left. Returns whether the character was taken.
 */
export function takeTypedWhileSwitching(char: string): boolean {
  if (opening > 0) {
    typedWhileOpening += char;
    return true;
  }
  if (awaitedComposer === null) return false;
  const { key, until } = awaitedComposer;
  if (Date.now() > until || openComposerKey() !== key) {
    awaitedComposer = null;
    return false;
  }
  const drafts = useDraftStore.getState();
  drafts.setDraft(key, drafts.getDraft(key) + char);
  return true;
}

/**
 * Called by a composer once it is drawn for `key`: whether it is the composer of the
 * conversation just opened, which then takes the focus.
 */
export function composerShown(key: string): boolean {
  if (awaitedComposer?.key !== key) return false;
  awaitedComposer = null;
  return true;
}

/** The key the open conversation's composer keeps text under: its id, or the draft's key. */
function openComposerKey(): string | null {
  const { selectedConversationId, draftDirect } = useShellStore.getState();
  return draftDirect ? directDraftKey(draftDirect) : selectedConversationId;
}

/**
 * Opens the direct message with one person: the one this client has loaded, else a draft
 * whose first message creates it (also when the list cannot be read). A draft in a direct
 * space switches to that space first. One in a direct space, opened from a workspace, keeps
 * the way back to it. Someone this account blocked gets neither: the app says to unblock them
 * first. While it runs, {@link directOpening} is true, and what is typed meanwhile outside a
 * text field waits for the opened conversation's composer.
 */
export async function openDirectWith(target: DirectDraft): Promise<void> {
  const before = openComposerKey();
  opening += 1;
  let opened: string | null = null;
  try {
    opened = await openDirect(target);
  } finally {
    opening -= 1;
    if (opening === 0) {
      const typed = typedWhileOpening;
      typedWhileOpening = "";
      // Nothing opened, or the conversation already open: the keys belong where the person is.
      if (opened === null || opened === before) typeIntoOpenComposer(typed);
      else {
        awaitedComposer = { key: opened, until: Date.now() + AWAIT_COMPOSER_MS };
        const drafts = useDraftStore.getState();
        if (typed) drafts.setDraft(opened, drafts.getDraft(opened) + typed);
      }
    }
  }
}

/** Types `text` into the composer on screen, as the keys would have, when there is one. */
function typeIntoOpenComposer(text: string): void {
  const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
  if (!text || !composer) return;
  composer.focus();
  document.execCommand("insertText", false, text);
}

/** The work of {@link openDirectWith}; returns the key of what it opened, `null` for nothing. */
async function openDirect(target: DirectDraft): Promise<string | null> {
  if ("spaceId" in target) {
    const blocked = await blockedPrincipalIds().catch(() => new Set<string>());
    if (blocked.has(target.member.principalId)) {
      toast.info(asSentence(`You blocked ${target.member.name}`), {
        description: "Unblock them in Settings → Direct messages to message them.",
      });
      return null;
    }
  }
  useShellStore.getState().setActivePanel("inbox");
  if ("spaceId" in target) {
    const existing = await spaceDirect(target.member.principalId).catch(() => undefined);
    if (existing) {
      rememberDirectOrigin(existing.serverId, existing.id);
      selectDirectConversation(existing.serverId, existing.id);
      return existing.id;
    }
    rememberDirectOrigin(target.spaceId, null);
    if (useWorkspaceStore.getState().workspaceId !== target.spaceId) {
      useWorkspaceStore.getState().setWorkspaceId(target.spaceId);
    }
    useShellStore.getState().openDraftDirect(target);
    return directDraftKey(target);
  }
  const existing = await workspaceDirect(target.workspaceId, target.otherUserId).catch(
    () => undefined,
  );
  if (existing) {
    useShellStore.getState().setSelectedConversationId(existing.id);
    return existing.id;
  }
  useShellStore.getState().openDraftDirect(target);
  return directDraftKey(target);
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
