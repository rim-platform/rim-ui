import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  MutationAddConversationMembersArgs,
  MutationJoinChannelArgs,
  MutationLeaveConversationArgs,
  MutationRemoveConversationMemberArgs,
  MutationSetConversationArchivedArgs,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import { clearLeaving, markLeaving } from "../state/pendingLeaves";
import type { ConversationSummary } from "../types";
import { commitOwnMembershipChange } from "../../e2ee/runtime/membership";

const JOIN_CHANNEL = gql`
  mutation JoinChannel($serverId: ID!, $conversationId: ID!) {
    joinChannel(serverId: $serverId, conversationId: $conversationId) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

const LEAVE_CONVERSATION = gql`
  mutation LeaveConversation($serverId: ID!, $conversationId: ID!) {
    leaveConversation(serverId: $serverId, conversationId: $conversationId)
  }
`;

const ADD_CONVERSATION_MEMBERS = gql`
  mutation AddConversationMembers($serverId: ID!, $conversationId: ID!, $userIds: [ID!]!) {
    addConversationMembers(
      serverId: $serverId
      conversationId: $conversationId
      userIds: $userIds
    ) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

const REMOVE_CONVERSATION_MEMBER = gql`
  mutation RemoveConversationMember($serverId: ID!, $conversationId: ID!, $userId: ID!) {
    removeConversationMember(serverId: $serverId, conversationId: $conversationId, userId: $userId)
  }
`;

const SET_CONVERSATION_ARCHIVED = gql`
  mutation SetConversationArchived($serverId: ID!, $conversationId: ID!, $archived: Boolean!) {
    setConversationArchived(
      serverId: $serverId
      conversationId: $conversationId
      archived: $archived
    ) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

/**
 * Refreshes everything a membership or archive change can affect: both channel lists (the
 * `channels` prefix covers the joined list), the inbox, and the conversation itself.
 */
export function invalidateConversationQueries(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversation(serverId, conversationId) });
}

/** Join a public, unarchived channel. */
export function useJoinChannelMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationJoinChannelArgs) => {
      const res = await graphqlClient.request<{ joinChannel: ConversationSummary }>(
        JOIN_CHANNEL,
        vars,
      );
      return res.joinChannel;
    },
    onSuccess: (conversation, vars) => {
      qc.setQueryData(queryKeys.conversation(vars.serverId, vars.conversationId), conversation);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
      if (conversation.encryptedAt) commitOwnMembershipChange(vars.serverId, vars.conversationId);
    },
  });
}

/** Leave a channel or group (not a DM). */
/** Leave a conversation, outside React: as a person blocking whoever started it. */
export async function leaveConversation(serverId: string, conversationId: string): Promise<void> {
  await graphqlClient.request<{ leaveConversation: boolean }>(LEAVE_CONVERSATION, {
    serverId,
    conversationId,
  });
}

export function useLeaveConversationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationLeaveConversationArgs) => {
      const res = await graphqlClient.request<{ leaveConversation: boolean }>(
        LEAVE_CONVERSATION,
        vars,
      );
      return res.leaveConversation;
    },
    onMutate: (vars) => {
      markLeaving(vars.conversationId);
    },
    onSettled: (_data, _err, vars) => {
      clearLeaving(vars.conversationId);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
    },
  });
}

/** Add (invite) workspace members to a channel or group the viewer belongs to. */
export function useAddConversationMembersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationAddConversationMembersArgs) => {
      const res = await graphqlClient.request<{ addConversationMembers: ConversationSummary }>(
        ADD_CONVERSATION_MEMBERS,
        vars,
      );
      return res.addConversationMembers;
    },
    onSuccess: (conversation, vars) => {
      qc.setQueryData(queryKeys.conversation(vars.serverId, vars.conversationId), conversation);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
      if (conversation.encryptedAt) commitOwnMembershipChange(vars.serverId, vars.conversationId);
    },
  });
}

/** Remove a member (Owner/Moderator), or the viewer themselves. */
export function useRemoveConversationMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationRemoveConversationMemberArgs) => {
      const res = await graphqlClient.request<{ removeConversationMember: boolean }>(
        REMOVE_CONVERSATION_MEMBER,
        vars,
      );
      return res.removeConversationMember;
    },
    onSuccess: (_data, vars) => {
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
      commitOwnMembershipChange(vars.serverId, vars.conversationId);
    },
  });
}

/** Archive or unarchive a channel (Owner/Moderator). */
export function useSetConversationArchivedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationSetConversationArchivedArgs) => {
      const res = await graphqlClient.request<{ setConversationArchived: ConversationSummary }>(
        SET_CONVERSATION_ARCHIVED,
        vars,
      );
      return res.setConversationArchived;
    },
    onSuccess: (conversation, vars) => {
      qc.setQueryData(queryKeys.conversation(vars.serverId, vars.conversationId), conversation);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
      if (conversation.encryptedAt) commitOwnMembershipChange(vars.serverId, vars.conversationId);
    },
  });
}
