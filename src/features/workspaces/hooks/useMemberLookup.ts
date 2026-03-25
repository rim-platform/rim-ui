import { useMemo } from "react";

import { useCurrentUser } from "../api/useCurrentUser";
import { useServerMembers } from "../api/useServerMembers";

type MemberInfo = {
  displayName: string;
  role?: string;
  isCurrentUser: boolean;
};

export function useMemberLookup(serverId?: string) {
  const { data: me } = useCurrentUser();
  const { data: members } = useServerMembers(serverId ?? undefined);

  return useMemo(() => {
    const map = new Map<string, MemberInfo>();

    if (me) {
      map.set(me.id, {
        displayName: me.displayName ?? me.username,
        isCurrentUser: true,
      });
    }

    if (members) {
      for (const member of members) {
        if (!map.has(member.userId)) {
          map.set(member.userId, {
            displayName: member.username ?? member.userId.slice(0, 8),
            role: member.memberRole,
            isCurrentUser: false,
          });
        } else {
          const existing = map.get(member.userId)!;
          existing.role = member.memberRole;
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
