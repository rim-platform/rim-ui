import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { MESSAGE_BOT_FIELDS, MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import { botDisclosureDocument } from "../../updater/api/serverCapabilities";
import type { MessageItem } from "../../../core/types/messages";

const PINNED_MESSAGES_QUERY = gql`
  query PinnedMessages($serverId: ID!, $conversationId: ID!) {
    pinnedMessages(serverId: $serverId, conversationId: $conversationId) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

/** The same with the authors' bot disclosure, for a server that lists `bot_disclosure`. */
const PINNED_MESSAGES_WITH_BOTS_QUERY = gql`
  query PinnedMessagesWithBots($serverId: ID!, $conversationId: ID!) {
    pinnedMessages(serverId: $serverId, conversationId: $conversationId) {
      ...MessageWithReactions
      ...MessageBotFields
    }
  }
  ${MESSAGE_WITH_REACTIONS}
  ${MESSAGE_BOT_FIELDS}
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
      const document = await botDisclosureDocument({
        plain: PINNED_MESSAGES_QUERY,
        withBots: PINNED_MESSAGES_WITH_BOTS_QUERY,
      });
      const res = await graphqlClient.request<PinnedMessagesResponse>(document, {
        serverId: workspaceId!,
        conversationId: conversationId!,
      });
      return res.pinnedMessages;
    },
  });
}
