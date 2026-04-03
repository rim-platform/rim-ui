import { gql } from "graphql-request";
import { graphqlClient } from "../../../../core/graphql/client";

const MEMBERS_QUERY = gql`
  query AgentResolveMemberNames($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      username
    }
  }
`;

interface MemberRow {
  userId: string;
  username: string;
}

/** In-memory cache of userId → username per workspace. */
const cache = new Map<string, Map<string, string>>();

/**
 * Resolve a userId to a username.
 * Fetches and caches all members for the workspace on first call.
 */
export async function resolveUsername(workspaceId: string, userId: string): Promise<string> {
  let map = cache.get(workspaceId);
  if (!map) {
    map = await fetchMembers(workspaceId);
    cache.set(workspaceId, map);
  }
  return map.get(userId) ?? userId;
}

/**
 * Resolve multiple userIds at once.
 */
export async function resolveUsernames(
  workspaceId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  let map = cache.get(workspaceId);
  if (!map) {
    map = await fetchMembers(workspaceId);
    cache.set(workspaceId, map);
  }
  const result = new Map<string, string>();
  for (const id of userIds) {
    result.set(id, map.get(id) ?? id);
  }
  return result;
}

/** Invalidate cache (e.g. when members change). */
export function invalidateMemberCache(workspaceId?: string): void {
  if (workspaceId) {
    cache.delete(workspaceId);
  } else {
    cache.clear();
  }
}

async function fetchMembers(workspaceId: string): Promise<Map<string, string>> {
  const res = await graphqlClient.request<{ serverMembers: MemberRow[] }>(
    MEMBERS_QUERY,
    { serverId: workspaceId },
  );
  const map = new Map<string, string>();
  for (const m of res.serverMembers) {
    map.set(m.userId, m.username);
  }
  return map;
}
