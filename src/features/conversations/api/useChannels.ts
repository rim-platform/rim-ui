import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";

const ChannelsDocument = gql`
  query Channels($serverId: ID!, $dir: PageDir!, $limit: Int!) {
    channels(serverId: $serverId, dir: $dir, limit: $limit) {
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

export function useChannels(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.channels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        channels: {
          items: {
            id: string;
            serverId: string;
            conversationType: string;
            title: string;
            memberIds: string[];
            topic: string | null;
          }[];
          pageInfo: { hasNext: boolean; hasPrev: boolean };
        };
      }>(ChannelsDocument, {
        serverId: workspaceId!,
        dir: "AFTER",
        limit: 100,
      });
      return res.channels;
    },
  });
}
