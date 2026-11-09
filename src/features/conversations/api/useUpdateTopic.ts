import type { QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const UPDATE_CONVERSATION_TOPIC = gql`
  mutation UpdateConversationTopic($input: UpdateConversationTopicInput!) {
    updateConversationTopic(input: $input) {
      id
      topic
    }
  }
`;

interface UpdateTopicVars {
  serverId: string;
  conversationId: string;
  topic: string;
}

/** Refreshes the conversation lists of a workspace once a topic in it changed. */
export function invalidateTopicQueries(qc: QueryClient, serverId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
}

/** Sets a conversation's topic with the `updateConversationTopic` mutation, then refreshes its lists. */
export async function updateConversationTopic(
  qc: QueryClient,
  vars: UpdateTopicVars,
): Promise<void> {
  await graphqlClient.request(UPDATE_CONVERSATION_TOPIC, {
    input: { serverId: vars.serverId, conversationId: vars.conversationId, topic: vars.topic },
  });
  invalidateTopicQueries(qc, vars.serverId);
}
