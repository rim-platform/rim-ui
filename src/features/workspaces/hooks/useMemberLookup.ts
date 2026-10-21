import { useMemo } from "react";

import type { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import {
  handleDomain,
  personName,
  viewHandle,
  type HandleView,
} from "../../../shared/utils/handles";
import { useContactStore } from "../../relay/contacts/useContactStore";
import { useCurrentUser } from "../api/useCurrentUser";
import { useServerMembers } from "../api/useServerMembers";
import { useKnownHandles } from "../state/useKnownHandles";

type MemberInfo = {
  displayName: string;
  username?: string;
  /** `@<username>:<domain>` once a server answered it for this person. */
  handle?: string | null;
  /** How the handle reads to the viewer, and what Copy puts on the clipboard. */
  handleView: HandleView | null;
  role?: ServerMemberRoleGql;
  timeoutUntil?: string | null;
  isCurrentUser: boolean;
  avatarUrl?: string | null;
  statusText?: string | null;
  bio?: string | null;
  joinedAt?: string;
};

export function useMemberLookup(serverId?: string) {
  const { data: me } = useCurrentUser();
  const { data: members } = useServerMembers(serverId ?? undefined);
  // A name the person gave a contact wins over the name the member published.
  const aliases = useContactStore((s) => s.aliases);
  const handles = useKnownHandles((s) => s.byUser);

  return useMemo(() => {
    const map = new Map<string, MemberInfo>();
    /** The viewer's own handle domain: handles with it are shown as `@username`. */
    const ownDomain = handleDomain(me?.handle);

    if (me) {
      map.set(me.id, {
        displayName: me.displayName || me.username,
        username: me.username,
        handle: me.handle ?? handles[me.id] ?? null,
        handleView: null,
        isCurrentUser: true,
        avatarUrl: me.avatarUrl,
        statusText: me.statusText,
        bio: me.bio,
      });
    }

    if (members) {
      for (const member of members) {
        if (!map.has(member.userId)) {
          map.set(member.userId, {
            displayName: personName(
              { ...member, handle: handles[member.userId] },
              member.userId,
              ownDomain,
            ),
            username: member.username,
            handle: handles[member.userId] ?? null,
            handleView: null,
            role: member.memberRole,
            timeoutUntil: member.timeoutUntil ?? null,
            isCurrentUser: false,
            avatarUrl: member.avatarUrl,
            statusText: member.statusText,
            bio: member.bio,
            joinedAt: member.joinedAt,
          });
        } else {
          const existing = map.get(member.userId)!;
          existing.role = member.memberRole;
          existing.timeoutUntil = member.timeoutUntil ?? null;
          existing.joinedAt = member.joinedAt;
          if (member.avatarUrl) {
            existing.avatarUrl = member.avatarUrl;
          }
          if (member.statusText) {
            existing.statusText = member.statusText;
          }
          if (member.bio) {
            existing.bio = member.bio;
          }
          if (member.displayName) {
            existing.displayName = member.displayName;
          }
          if (member.username) {
            existing.username = member.username;
          }
        }
      }
    }

    for (const member of members ?? []) {
      const alias = member.principalId ? aliases[member.principalId] : undefined;
      const info = map.get(member.userId);
      if (alias && info && !info.isCurrentUser) info.displayName = alias;
    }

    for (const info of map.values()) {
      info.handleView = viewHandle(info.username, info.handle, ownDomain);
    }

    function resolve(userId: string): MemberInfo {
      const handle = handles[userId] ?? null;
      return (
        map.get(userId) ?? {
          displayName: userId.slice(0, 8),
          handle,
          handleView: viewHandle(null, handle, ownDomain),
          isCurrentUser: false,
        }
      );
    }

    return { resolve, map, ownDomain };
  }, [me, members, aliases, handles]);
}
