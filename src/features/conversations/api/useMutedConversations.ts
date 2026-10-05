import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useMutedStore } from "../state/useMutedStore";

const MUTED_CONVERSATIONS_QUERY = gql`
  query MutedConversations($serverId: ID!) {
    mutedConversations(serverId: $serverId) {
      conversationId
      mutedUntil
    }
  }
`;

export interface MutedConversationItem {
  conversationId: string;
  mutedUntil: string | null;
}

/** Level `NONE` (no end) or a timed mute that has not ended yet. */
export function isMuteActive(item: MutedConversationItem, now = Date.now()): boolean {
  return item.mutedUntil === null || Date.parse(item.mutedUntil) > now;
}

export function useMutedConversations(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.mutedConversations(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        mutedConversations: MutedConversationItem[];
      }>(MUTED_CONVERSATIONS_QUERY, { serverId: workspaceId! });

      // The list also carries timed mutes that have already ended; only live ones count.
      const ids = res.mutedConversations.filter(isMuteActive).map((m) => m.conversationId);
      useMutedStore.getState().setMutedIds(ids);

      return res.mutedConversations;
    },
  });
}
