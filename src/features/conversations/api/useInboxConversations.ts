import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";

const INBOX_CONVERSATIONS_QUERY = gql`
  query InboxConversations($serverId: ID!, $dir: PageDir!, $limit: Int!) {
    inboxConversations(serverId: $serverId, dir: $dir, limit: $limit) {
      items {
        ...ConversationFields
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${CONVERSATION_FIELDS}
`;

interface ConversationItem {
  id: string;
  serverId: string;
  conversationType: string;
  title: string;
  memberIds: string[];
}

interface InboxConversationsResponse {
  inboxConversations: {
    items: ConversationItem[];
    pageInfo: { hasNext: boolean; hasPrev: boolean };
  };
}

export function useInboxConversations(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.conversations(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<InboxConversationsResponse>(
        INBOX_CONVERSATIONS_QUERY,
        {
          serverId: workspaceId!,
          dir: "AFTER",
          limit: 50,
        },
      );
      return res.inboxConversations;
    },
  });
}
