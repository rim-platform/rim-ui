import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useConversation } from "./useConversation";

/** Asked on its own, so a host without the field fails only here. */
const DM_REQUEST_PENDING_QUERY = gql`
  query ConversationDmRequestPending($serverId: ID!, $conversationId: ID!) {
    conversation(serverId: $serverId, conversationId: $conversationId) {
      id
      dmRequestPending
    }
  }
`;

/** How often a pending request is asked about again, to notice its acceptance. */
const PENDING_RECHECK_MS = 30_000;

/**
 * Whether the other member of a direct conversation still has the viewer's DM as a request
 * they have not accepted. False for every other conversation, and when the host cannot say.
 */
export function useDmRequestPending(
  workspaceId?: string | null,
  conversationId?: string | null,
): boolean {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const direct = conversation?.conversationType === ConversationTypeEnum.DIRECT;
  const { data } = useQuery({
    queryKey: queryKeys.dmRequestPending(workspaceId ?? undefined, conversationId ?? undefined),
    enabled: Boolean(workspaceId && conversationId && direct),
    staleTime: PENDING_RECHECK_MS,
    retry: false,
    refetchInterval: (query) => (query.state.data ? PENDING_RECHECK_MS : false),
    queryFn: async () => {
      const res = await graphqlClient.request<{
        conversation: { dmRequestPending: boolean | null };
      }>(DM_REQUEST_PENDING_QUERY, { serverId: workspaceId, conversationId });
      return res.conversation.dmRequestPending === true;
    },
  });
  return direct && data === true;
}
