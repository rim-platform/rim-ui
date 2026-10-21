import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { useRelayStore } from "../state/useRelayStore";
import { useDirectSpaceIds } from "./useDirectInbox";

/** A member of one of the viewer's workspaces who can be messaged in the direct space. */
export interface WorkspacePerson {
  principalId: string;
  /** The display name, else the username, from the first workspace that lists them. */
  name: string;
  username: string;
}

/** The member lists read so far, and whether any is still loading. */
function combineLists(results: UseQueryResult<ServerMember[]>[]) {
  return {
    lists: results.map((result) => result.data ?? []),
    isPending: results.some((result) => result.isPending),
  };
}

/**
 * The people in the viewer's workspaces, here and on other servers, who have a principal id:
 * each once, sorted by name, never the viewer. Each workspace's member list is read through
 * the same cached query the member lists and pickers use, so an open workspace costs nothing
 * more and the others are read once a minute at most.
 *
 * @returns the people, and whether the workspaces or any member list are still loading.
 */
export function useWorkspacePeople(): { people: WorkspacePerson[]; isPending: boolean } {
  const servers = useMyServers();
  const directSpaceIds = useDirectSpaceIds();
  const spaces = useRelayStore((s) => s.spaces);
  const forked = useRelayStore((s) => s.forked);
  const me = useRelayStore((s) => s.account?.principalId ?? null);

  const workspaceIds = useMemo(() => {
    const here = (servers.data ?? []).map((server) => server.id);
    const elsewhere = Object.values(spaces)
      .filter((space) => space.kind === "workspace" && !forked.includes(space.hostServerId))
      .map((space) => space.spaceId);
    return [...new Set([...here, ...elsewhere])].filter((id) => !directSpaceIds.includes(id));
  }, [servers.data, spaces, forked, directSpaceIds]);

  const memberLists = useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: queryKeys.serverMembers(workspaceId),
      staleTime: 60_000,
      networkMode: "offlineFirst" as const,
      queryFn: () => fetchServerMembers(workspaceId),
    })),
    combine: combineLists,
  });

  const people = useMemo(() => {
    const byPrincipal = new Map<string, WorkspacePerson>();
    for (const member of memberLists.lists.flat()) {
      const principalId = member.principalId;
      if (!principalId || principalId === me || byPrincipal.has(principalId)) continue;
      byPrincipal.set(principalId, {
        principalId,
        name: member.displayName || member.username,
        username: member.username,
      });
    }
    return [...byPrincipal.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [memberLists.lists, me]);

  return {
    people,
    isPending: servers.isPending || memberLists.isPending,
  };
}
