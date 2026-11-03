import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import {
  CONVERSATION_MEMBER_REMOVALS as CONVERSATION_MEMBER_REMOVALS_CAPABILITY,
  serverHasCapability,
} from "../../updater/api/serverCapabilities";

const CONVERSATION_MEMBER_REMOVALS = gql`
  query ConversationMemberRemovals($serverId: ID!, $conversationId: ID!) {
    conversationMemberRemovals(serverId: $serverId, conversationId: $conversationId) {
      id
      userId
      removedById
      removedAt
      user {
        id
        username
        displayName
      }
      removedBy {
        id
        username
        displayName
      }
    }
  }
`;

/** Someone an Owner or Moderator removed from a channel. */
export interface MemberRemoval {
  id: string;
  userId: string;
  removedById: string;
  removedAt: string;
  user: { id: string; username: string; displayName: string | null } | null;
  removedBy: { id: string; username: string; displayName: string | null } | null;
}

/**
 * A channel's latest removals, newest first, read while `enabled` (the conversation is a
 * channel); empty from a server without `conversation_member_removals`.
 */
export function useMemberRemovals(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
  enabled: boolean,
) {
  const ws = workspaceId ?? undefined;
  const id = conversationId ?? undefined;
  return useQuery({
    queryKey: queryKeys.conversationMemberRemovals(ws, id),
    enabled: Boolean(ws && id) && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<MemberRemoval[]> => {
      if (!(await serverHasCapability(CONVERSATION_MEMBER_REMOVALS_CAPABILITY))) return [];
      const res = await graphqlClient.request<{ conversationMemberRemovals: MemberRemoval[] }>(
        CONVERSATION_MEMBER_REMOVALS,
        { serverId: ws, conversationId: id },
      );
      return res.conversationMemberRemovals;
    },
  });
}
