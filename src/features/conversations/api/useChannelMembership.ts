import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  MutationAddConversationMembersArgs,
  MutationJoinChannelArgs,
  MutationLeaveConversationArgs,
  MutationRemoveConversationMemberArgs,
  MutationSetConversationArchivedArgs,
  RemoteMemberInput,
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

const ADD_DIRECT_CONVERSATION_MEMBERS = gql`
  mutation AddDirectConversationMembers(
    $serverId: ID!
    $conversationId: ID!
    $remoteMembers: [RemoteMemberInput!]!
  ) {
    addConversationMembers(
      serverId: $serverId
      conversationId: $conversationId
      remoteMembers: $remoteMembers
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
  qc.invalidateQueries({
    queryKey: queryKeys.conversationMemberRemovals(serverId, conversationId),
  });
}

/**
 * Refreshes what a join, an invitation, an archive change or a member's removal affects, and
 * commits this device's membership change to an encrypted conversation's group.
 *
 * @param encrypted - Whether the conversation is end-to-end encrypted.
 */
export function refreshAfterMembershipChange(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
  encrypted: boolean,
): void {
  invalidateConversationQueries(qc, serverId, conversationId);
  if (encrypted) commitOwnMembershipChange(serverId, conversationId);
}

/** Notes that the viewer is leaving a conversation, before the leave is sent. */
export function startLeaving(conversationId: string): void {
  markLeaving(conversationId);
}

/** Ends a leave, whichever way it went, and refreshes what it affects. */
export function finishLeaving(qc: QueryClient, serverId: string, conversationId: string): void {
  clearLeaving(conversationId);
  invalidateConversationQueries(qc, serverId, conversationId);
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
      refreshAfterMembershipChange(
        qc,
        vars.serverId,
        vars.conversationId,
        Boolean(conversation.encryptedAt),
      );
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
      startLeaving(vars.conversationId);
    },
    onSettled: (_data, _err, vars) => {
      finishLeaving(qc, vars.serverId, vars.conversationId);
    },
  });
}

/**
 * Stores the conversation an addition returns, refreshes what it affects, and commits the
 * server's pending adds to an encrypted conversation's group.
 */
function afterMembersAdded(
  qc: QueryClient,
  conversation: ConversationSummary,
  vars: { serverId: string; conversationId: string },
): void {
  qc.setQueryData(queryKeys.conversation(vars.serverId, vars.conversationId), conversation);
  refreshAfterMembershipChange(
    qc,
    vars.serverId,
    vars.conversationId,
    Boolean(conversation.encryptedAt),
  );
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
    onSuccess: (conversation, vars) => afterMembersAdded(qc, conversation, vars),
  });
}

/** Add people to a group of the direct space, named by principal id and relays. */
export function useAddDirectConversationMembersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      serverId: string;
      conversationId: string;
      remoteMembers: RemoteMemberInput[];
    }) => {
      const res = await graphqlClient.request<{ addConversationMembers: ConversationSummary }>(
        ADD_DIRECT_CONVERSATION_MEMBERS,
        vars,
      );
      return res.addConversationMembers;
    },
    onSuccess: (conversation, vars) => afterMembersAdded(qc, conversation, vars),
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
      refreshAfterMembershipChange(qc, vars.serverId, vars.conversationId, true);
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
      refreshAfterMembershipChange(
        qc,
        vars.serverId,
        vars.conversationId,
        Boolean(conversation.encryptedAt),
      );
    },
  });
}
