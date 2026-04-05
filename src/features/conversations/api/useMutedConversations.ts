import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { useMutedStore } from "../state/useMutedStore";

const MUTED_CONVERSATIONS_QUERY = gql`
  query MutedConversations($serverId: ID!) {
    mutedConversations(serverId: $serverId) {
      conversationId
      mutedUntil
    }
  }
`;

interface MutedConversationItem {
  conversationId: string;
  mutedUntil: string | null;
}

export function useMutedConversations(workspaceId?: string) {
  return useQuery({
    queryKey: ["mutedConversations", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        mutedConversations: MutedConversationItem[];
      }>(MUTED_CONVERSATIONS_QUERY, { serverId: workspaceId! });

      const ids = res.mutedConversations.map((m) => m.conversationId);
      useMutedStore.getState().setMutedIds(ids);

      return res.mutedConversations;
    },
  });
}
