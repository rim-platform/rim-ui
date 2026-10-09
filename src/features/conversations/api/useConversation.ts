import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import type { ConversationSummary, ConversationSummaryPage } from "../types";

const CONVERSATION_QUERY = gql`
  query Conversation($serverId: ID!, $conversationId: ID!) {
    conversation(serverId: $serverId, conversationId: $conversationId) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

/**
 * Looks a conversation up in the list caches (sidebar, browse list, inbox) so the header and
 * composer can render before the `conversation` query answers.
 */
export function findCachedConversation(
  qc: QueryClient,
  workspaceId: string | undefined,
  conversationId: string | undefined,
): ConversationSummary | undefined {
  if (!workspaceId || !conversationId) return undefined;
  const lists = [
    queryKeys.joinedChannels(workspaceId),
    queryKeys.channels(workspaceId),
    queryKeys.conversations(workspaceId),
  ];
  for (const key of lists) {
    const page = qc.getQueryData<ConversationSummaryPage>(key);
    const hit = page?.items.find((c) => c.id === conversationId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * One conversation by id, including the viewer's membership (`isMember`) and archive state.
 * Works for public channels the viewer has not joined; a private channel the viewer is not in
 * answers `NOT_FOUND`.
 */
export function useConversation(workspaceId?: string | null, conversationId?: string | null) {
  const qc = useQueryClient();
  const ws = workspaceId ?? undefined;
  const id = conversationId ?? undefined;
  return useQuery({
    queryKey: queryKeys.conversation(ws, id),
    enabled: Boolean(ws && id),
    staleTime: 30_000,
    placeholderData: () => findCachedConversation(qc, ws, id),
    queryFn: () => requestConversation(ws!, id!),
  });
}

async function requestConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const res = await graphqlClient.request<{ conversation: ConversationSummary }>(
    CONVERSATION_QUERY,
    { serverId: workspaceId, conversationId },
  );
  return res.conversation;
}

/** One conversation by id outside React, through the same query cache as {@link useConversation}. */
export function fetchConversation(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  return qc.fetchQuery({
    queryKey: queryKeys.conversation(workspaceId, conversationId),
    staleTime: 30_000,
    queryFn: () => requestConversation(workspaceId, conversationId),
  });
}
