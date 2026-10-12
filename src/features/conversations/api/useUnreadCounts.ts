import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useUnreadStore } from "../state/useUnreadStore";

const UNREAD_COUNTS_QUERY = gql`
  query UnreadCounts($workspaceId: ID!) {
    unreadCounts(workspaceId: $workspaceId) {
      conversationId
      count
    }
  }
`;

interface UnreadCountItem {
  conversationId: string;
  count: number;
}

export function useUnreadCounts(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.unreadCounts(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        unreadCounts: UnreadCountItem[];
      }>(UNREAD_COUNTS_QUERY, { workspaceId: workspaceId! });

      const counts: Record<string, number> = {};
      for (const item of res.unreadCounts) {
        if (item.count > 0) {
          counts[item.conversationId] = item.count;
        }
      }
      useUnreadStore.getState().setCounts(workspaceId!, counts);

      return res.unreadCounts;
    },
  });
}
