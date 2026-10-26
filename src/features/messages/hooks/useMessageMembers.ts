import { useCallback, useMemo } from "react";

import type { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import type { MessageMembers } from "../components/message-item/types";
import type { AuthorBan } from "./useBanExpiry";
import { activeBan, banLabel } from "./useBanExpiry";

/** What `useMessageMembers` reads from a message: its author's id and the author the server sent. */
type MemberSource = {
  authorId: string;
  author?: (AuthorBan & { displayName?: string | null; username?: string | null }) | null;
};

/** The name a row shows for a message's author. */
export function authorNameOf(
  msg: Pick<MemberSource, "author">,
  member: { displayName?: string | null },
): string {
  return member.displayName || msg.author?.displayName || msg.author?.username || "Former member";
}

/**
 * The member names and ban details the rows of a message list read: the workspace's members,
 * plus the authors of `messages` who are no longer members, named with their ban or as former
 * members.
 *
 * @param memberLookup - The workspace's member lookup.
 * @param messages - The messages shown; a new array each render is fine.
 * @returns A `resolve` that adds an author's ban, and a user id to display name map for mentions.
 */
export function useMessageMembers(
  memberLookup: ReturnType<typeof useMemberLookup>,
  messages: readonly MemberSource[],
): MessageMembers {
  const formerNamesKey = JSON.stringify(
    [
      ...new Map(
        messages
          .filter((message) => !memberLookup.map.has(message.authorId))
          .map((message) => [
            message.authorId,
            `${authorNameOf(message, memberLookup.resolve(message.authorId))}${activeBan(message.author) ? ` (${banLabel(message.author)})` : memberLookup.resolve(message.authorId).isFormerMember ? " (former member)" : ""}`,
          ]),
      ).entries(),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  // userId -> displayName map for mention rendering
  const memberDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, info] of memberLookup.map) map.set(userId, info.displayName);
    for (const [id, name] of JSON.parse(formerNamesKey) as [string, string][]) map.set(id, name);
    return map;
  }, [memberLookup.map, formerNamesKey]);
  const banDetailsKey = JSON.stringify(
    [
      ...new Map(
        messages
          .filter((message) => !memberLookup.map.has(message.authorId))
          .map((message) => [
            message.authorId,
            {
              banned: activeBan(message.author),
              bannedUntil: message.author?.bannedUntil,
              banReason: message.author?.banReason,
            },
          ]),
      ).entries(),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  const authorBans = useMemo(
    () => new Map<string, AuthorBan>(JSON.parse(banDetailsKey)),
    [banDetailsKey],
  );
  const lookupMember = memberLookup.resolve;
  const resolveMember = useCallback(
    (id: string) => ({ ...lookupMember(id), ban: authorBans.get(id) }),
    [lookupMember, authorBans],
  );
  return useMemo<MessageMembers>(
    () => ({ resolve: resolveMember, displayMap: memberDisplayMap }),
    [resolveMember, memberDisplayMap],
  );
}
