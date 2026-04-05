import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import type { MessageItem } from "../../../core/types/messages";

const PINNED_MESSAGES_QUERY = gql`
  query PinnedMessages($serverId: ID!, $conversationId: ID!) {
    pinnedMessages(serverId: $serverId, conversationId: $conversationId) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

interface PinnedMessagesResponse {
  pinnedMessages: MessageItem[];
}

export function usePinnedMessages(workspaceId?: string, conversationId?: string) {
  return useQuery({
    queryKey: queryKeys.pinnedMessages(workspaceId, conversationId),
    enabled: Boolean(workspaceId && conversationId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<PinnedMessagesResponse>(
        PINNED_MESSAGES_QUERY,
        {
          serverId: workspaceId!,
          conversationId: conversationId!,
        },
      );
      return res.pinnedMessages;
    },
  });
}
