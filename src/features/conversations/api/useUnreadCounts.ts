import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { isBlockedConversation } from "../../relay/state/useBlockedConversations";
import { hostOf } from "../../relay/state/useRelayStore";
import { READ_MARKER, spaceHasCapability } from "../../updater/api/serverCapabilities";
import { useUnreadStore } from "../state/useUnreadStore";

const UNREAD_COUNTS_QUERY = gql`
  query UnreadCounts($workspaceId: ID!) {
    unreadCounts(workspaceId: $workspaceId) {
      conversationId
      count
    }
  }
`;

/** The same with each read marker, for a host that lists `read_marker`. */
const UNREAD_COUNTS_WITH_MARKERS_QUERY = gql`
  query UnreadCountsWithMarkers($workspaceId: ID!) {
    unreadCounts(workspaceId: $workspaceId) {
      conversationId
      count
      unreadAfter
    }
  }
`;

interface UnreadCountItem {
  conversationId: string;
  count: number;
  /** Messages sent after this time count as unread; absent from a host without read markers. */
  unreadAfter?: string;
}

/**
 * Fetches one space's unread counts and puts them in the unread store, with the read markers of
 * a host that has them, leaving out conversations hidden because someone blocked started them.
 */
export async function fetchUnreadCounts(workspaceId: string): Promise<UnreadCountItem[]> {
  const withMarkers = await spaceHasCapability(workspaceId, READ_MARKER);
  const res = await graphqlClient.request<{
    unreadCounts: UnreadCountItem[];
  }>(withMarkers ? UNREAD_COUNTS_WITH_MARKERS_QUERY : UNREAD_COUNTS_QUERY, { workspaceId });

  const shown = res.unreadCounts.filter(
    (item) => !isBlockedConversation(workspaceId, item.conversationId),
  );
  const counts: Record<string, number> = {};
  const markers: Record<string, string> = {};
  for (const item of shown) {
    if (item.count > 0) {
      counts[item.conversationId] = item.count;
      if (item.unreadAfter) markers[item.conversationId] = item.unreadAfter;
    }
  }
  useUnreadStore.getState().setCounts(workspaceId, counts, withMarkers ? markers : undefined);

  return shown;
}

/** How often the counts of an open workspace on another server are read again. */
const REMOTE_UNREAD_POLL_MS = 60_000;

/**
 * One space's unread counts, kept in the unread store. They are read again when the window
 * regains focus, and through the invalidations on a WebSocket reconnect and on a gap in a relay
 * stream. A workspace on another server is also polled: while the relay alone is cut off from its
 * host this app sees no reconnect, and a `ReadMarkerRewound` missed then leaves no gap.
 */
export function useUnreadCounts(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.unreadCounts(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: () => (hostOf(workspaceId) ? REMOTE_UNREAD_POLL_MS : false),
    queryFn: () => fetchUnreadCounts(workspaceId!),
  });
}
