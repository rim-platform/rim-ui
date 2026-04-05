import { useMemo } from "react";

import { useCurrentUser } from "../api/useCurrentUser";
import { useServerMembers } from "../api/useServerMembers";

type MemberInfo = {
  displayName: string;
  username?: string;
  role?: string;
  isCurrentUser: boolean;
  avatarUrl?: string | null;
  statusText?: string | null;
  bio?: string | null;
  joinedAt?: string;
};

export function useMemberLookup(serverId?: string) {
  const { data: me } = useCurrentUser();
  const { data: members } = useServerMembers(serverId ?? undefined);

  return useMemo(() => {
    const map = new Map<string, MemberInfo>();

    if (me) {
      map.set(me.id, {
        displayName: me.displayName || me.username,
        username: me.username,
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
            displayName: member.displayName || member.username || member.userId.slice(0, 8),
            username: member.username,
            role: member.memberRole,
            isCurrentUser: false,
            avatarUrl: member.avatarUrl,
            statusText: member.statusText,
            bio: member.bio,
            joinedAt: member.joinedAt,
          });
        } else {
          const existing = map.get(member.userId)!;
          existing.role = member.memberRole;
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

    function resolve(userId: string): MemberInfo {
      return map.get(userId) ?? {
        displayName: userId.slice(0, 8),
        isCurrentUser: false,
      };
    }

    return { resolve, map };
  }, [me, members]);
}
