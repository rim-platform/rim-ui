/**
 * Who started the conversations of a direct space on another server. A conversation whose
 * creator this account blocked is left out of the space's list and recorded in
 * `useBlockedConversations`, as this server does for its own direct space.
 */

import { asSentence, isSchemaRefusal } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import type { ConversationSummary, ConversationSummaryPage } from "../../conversations/types";
import { shortPrincipal } from "../../plugins/registry/model";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { blockedPrincipalsQuery } from "../api/useBlockedPrincipals";
import { useContactStore } from "../contacts/useContactStore";
import { blockedPrincipalOf, useBlockedConversations } from "../state/useBlockedConversations";
import { useRelayStore } from "../state/useRelayStore";

/** The server refused `myBlockedPrincipals` as unknown. */
let unsupported = false;
/** The blocked list the last filtering used. */
let appliedKey: string | null = null;
/** `spaceId|creatorId` pairs whose members were already refetched once. */
const askedAgain = new Set<string>();

/**
 * The conversations of `items` whose creator, as `members` names them, has a principal id in
 * `blocked`: conversation id → that principal id. A creator `members` does not name, or one
 * without a principal id, hides nothing.
 */
export function blockedCreatorConversations(
  items: readonly Pick<ConversationSummary, "id" | "createdBy">[],
  members: readonly Pick<ServerMember, "userId" | "principalId">[],
  blocked: ReadonlySet<string>,
): Record<string, string> {
  const found: Record<string, string> = {};
  if (blocked.size === 0) return found;
  const principalOf = new Map(members.map((m) => [m.userId, m.principalId ?? null]));
  for (const item of items) {
    const principal = item.createdBy ? principalOf.get(item.createdBy) : null;
    if (principal && blocked.has(principal)) found[item.id] = principal;
  }
  return found;
}

/** A blocked list as one comparable string: its principal ids, sorted. */
export function blockedKey(list: readonly { principalId: string }[]): string {
  return list
    .map((b) => b.principalId)
    .sort()
    .join(",");
}

/**
 * The principal ids this account blocked, from a list at most a minute old. A server that does
 * not know `myBlockedPrincipals` blocks nobody, and is not asked again until sign-out.
 * @throws when the list cannot be read for any other reason
 */
export async function blockedPrincipalIds(): Promise<ReadonlySet<string>> {
  if (unsupported) return new Set();
  try {
    const list = await queryClient.fetchQuery(blockedPrincipalsQuery);
    appliedKey = blockedKey(list);
    return new Set(list.map((b) => b.principalId));
  } catch (err) {
    if (!isSchemaRefusal(err)) throw err;
    unsupported = true;
    appliedKey = "";
    return new Set();
  }
}

/** The key of the blocked list the last filtering used; null before any. */
export function appliedBlockedKey(): string | null {
  return appliedKey;
}

/** Whether the server refused `myBlockedPrincipals` as unknown. */
export function blockedListUnsupported(): boolean {
  return unsupported;
}

/** Forget the module's state on sign-out. */
export function resetBlockedCreators(): void {
  unsupported = false;
  appliedKey = null;
  askedAgain.clear();
}

function membersOf(spaceId: string, staleTime: number): Promise<ServerMember[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.serverMembers(spaceId),
    queryFn: () => fetchServerMembers(spaceId),
    staleTime,
  });
}

async function creatorsBlocked(
  spaceId: string,
  items: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): Promise<Record<string, string>> {
  let members = await membersOf(spaceId, 60_000);
  const known = new Set(members.map((m) => m.userId));
  const unknown = items
    .map((c) => c.createdBy)
    .filter((id): id is string => !!id && !known.has(id) && !askedAgain.has(`${spaceId}|${id}`));
  if (unknown.length > 0) {
    for (const id of unknown) askedAgain.add(`${spaceId}|${id}`);
    members = await membersOf(spaceId, 0);
  }
  return blockedCreatorConversations(items, members, blocked);
}

/**
 * `page` without the conversations of `spaceId`, a direct space on another server, that someone
 * this account blocked started; records them in `useBlockedConversations`. Any other space
 * passes unchanged and asks nothing. When the blocked list or the members cannot be read, what
 * was recorded for the space before stays out and nothing new is hidden.
 */
export async function withoutBlockedCreators(
  spaceId: string,
  page: ConversationSummaryPage,
): Promise<ConversationSummaryPage> {
  if (useRelayStore.getState().spaces[spaceId]?.kind !== "direct") return page;
  let found: Record<string, string>;
  try {
    const blocked = await blockedPrincipalIds();
    found = blocked.size === 0 ? {} : await creatorsBlocked(spaceId, page.items, blocked);
  } catch (err) {
    logger.warn("[RIM:relay] checking who started a space's conversations failed:", err);
    found = useBlockedConversations.getState().bySpace[spaceId] ?? {};
  }
  useBlockedConversations.getState().setIn(spaceId, found);
  return { ...page, items: page.items.filter((c) => !(c.id in found)) };
}

/**
 * How the app names a blocked person: the name given to them as a contact, their name in
 * `spaceId`'s member list, their name on this server, or a short principal id.
 */
export function blockedPersonName(spaceId: string | null, principalId: string): string {
  const alias = useContactStore.getState().aliases[principalId];
  if (alias) return alias;
  const member = queryClient
    .getQueryData<ServerMember[]>(queryKeys.serverMembers(spaceId ?? undefined))
    ?.find((m) => m.principalId === principalId);
  if (member?.displayName || member?.username) return member.displayName || member.username;
  const account = queryClient
    .getQueryData<{ principalId: string; displayName: string | null; username: string | null }[]>(
      queryKeys.myBlockedPrincipals,
    )
    ?.find((b) => b.principalId === principalId);
  return account?.displayName || account?.username || shortPrincipal(principalId);
}

/**
 * Says to unblock first when `conversationId` of `spaceId` is hidden because someone this
 * account blocked started it.
 * @returns whether it is hidden, so the caller opens nothing
 */
export function refuseBlockedConversation(
  spaceId: string | null | undefined,
  conversationId: string,
): boolean {
  const principalId = blockedPrincipalOf(spaceId, conversationId);
  if (!principalId) return false;
  toast.info(asSentence(`You blocked ${blockedPersonName(spaceId ?? null, principalId)}`), {
    description: "Unblock them in Settings → Direct messages to message them.",
  });
  return true;
}
