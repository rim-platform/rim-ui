import { useQueries } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useDirectSpaceIds } from "../../relay/api/useDirectInbox";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { fetchUnreadCounts } from "./useUnreadCounts";

const UNREAD_POLL_MS = 60_000;

/**
 * Keeps the unread counts of every workspace of this account in the unread store, apart from
 * the open one and the direct spaces, whose counts are fetched where they are subscribed.
 * Those workspaces send no live events here, so their counts are polled.
 */
export function useAllWorkspaceUnreadCounts(openWorkspaceId: string | null) {
  const { data: servers } = useMyServers();
  const directSpaceIds = useDirectSpaceIds();
  const others = (servers ?? [])
    .map((server) => server.id)
    .filter((id) => id !== openWorkspaceId && !directSpaceIds.includes(id));

  useQueries({
    queries: others.map((workspaceId) => ({
      queryKey: queryKeys.unreadCounts(workspaceId),
      staleTime: UNREAD_POLL_MS,
      refetchOnWindowFocus: true,
      refetchInterval: UNREAD_POLL_MS,
      queryFn: () => fetchUnreadCounts(workspaceId),
    })),
  });
}
