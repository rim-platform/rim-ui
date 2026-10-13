import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";

/** The fields of a cached workspace member that name them. */
export interface CachedMember {
  userId: string;
  username?: string;
  displayName?: string | null;
  principalId?: string | null;
}

/** `userId`'s entry in the cached member list of `workspaceId`, if that list is loaded. */
export function cachedMember(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
): CachedMember | undefined {
  return qc
    .getQueryData<CachedMember[]>(queryKeys.serverMembers(workspaceId))
    ?.find((m) => m.userId === userId);
}

/**
 * `userId`'s name from the caches: the member's display name, else username; for the signed-in
 * account, its own. Undefined when neither cache knows them.
 */
export function memberName(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
): string | undefined {
  const member = cachedMember(qc, workspaceId, userId);
  if (member) return member.displayName || member.username || undefined;
  const me = qc.getQueryData<{ id: string; username: string; displayName?: string | null }>(
    queryKeys.me,
  );
  return me && me.id === userId ? me.displayName || me.username : undefined;
}
