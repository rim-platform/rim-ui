import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  MutationAcceptConversationInviteArgs,
  MutationDeclineConversationInviteArgs,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { refreshGroups } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { clearLeaving, markLeaving } from "../state/pendingLeaves";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import type { ConversationSummary, ConversationSummaryPage } from "../types";
import { isInvited } from "../utils";
import { invalidateConversationQueries } from "./useChannelMembership";
import { inboxQueryOptions } from "./useInboxConversations";

const ACCEPT_CONVERSATION_INVITE = gql`
  mutation AcceptConversationInvite($serverId: ID!, $conversationId: ID!) {
    acceptConversationInvite(serverId: $serverId, conversationId: $conversationId) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

const DECLINE_CONVERSATION_INVITE = gql`
  mutation DeclineConversationInvite($serverId: ID!, $conversationId: ID!) {
    declineConversationInvite(serverId: $serverId, conversationId: $conversationId)
  }
`;

/** Whether the viewer is only invited to a conversation, and whether that is known yet. */
export interface InvitationState {
  /** The conversation as the inbox lists it, when the viewer holds an invitation to it. */
  invitation: ConversationSummary | null;
  /** The inbox answered (or failed): until then nobody knows whether this is an invitation. */
  known: boolean;
}

/**
 * Whether the viewer holds an invitation to the conversation, from the inbox: the server answers
 * `conversation` and `messages` with `FORBIDDEN` for an invited viewer, so callers wait for
 * `known` before asking for either. Loads the inbox only when nothing has yet.
 */
export function useInvitation(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
): InvitationState {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data, isPending } = useQuery({
    ...inboxQueryOptions(workspaceId ?? undefined),
    refetchOnMount: false,
    select: (page: ConversationSummaryPage) =>
      page.items.find((c) => c.id === conversationId && isInvited(c, userId)) ?? null,
  });
  return { invitation: data ?? null, known: !isPending };
}

/** Replace or drop one conversation in the inbox list. */
function patchInbox(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  next: ConversationSummary | null,
) {
  qc.setQueryData<ConversationSummaryPage>(queryKeys.conversations(workspaceId), (old) => {
    if (!old) return old;
    const items = next
      ? old.items.map((c) => (c.id === conversationId ? next : c))
      : old.items.filter((c) => c.id !== conversationId);
    return { ...old, items };
  });
}

/**
 * Drop an invitation that is gone (declined, expired, withdrawn) from the inbox and, when it is
 * open, close it: the conversation list then opens its first conversation.
 */
export function leaveInvitation(qc: QueryClient, workspaceId: string, conversationId: string) {
  const shell = useShellStore.getState();
  if (shell.selectedConversationId === conversationId) {
    useMembersPanelStore.getState().setOpen(false);
    shell.setSelectedConversationId(null);
  }
  patchInbox(qc, workspaceId, conversationId, null);
}

/**
 * Accept an invitation: the viewer becomes a member, the conversation loads like any other, and
 * this device's view of the group is read again while a member's device adds it.
 */
export function useAcceptConversationInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationAcceptConversationInviteArgs) => {
      const res = await graphqlClient.request<{ acceptConversationInvite: ConversationSummary }>(
        ACCEPT_CONVERSATION_INVITE,
        vars,
      );
      return res.acceptConversationInvite;
    },
    onSuccess: (conversation, vars) => {
      qc.setQueryData(queryKeys.conversation(vars.serverId, vars.conversationId), conversation);
      patchInbox(qc, vars.serverId, vars.conversationId, conversation);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
      void e2eeSession()
        .then((session) =>
          session ? refreshGroups(session, vars.serverId, [vars.conversationId]) : null,
        )
        .catch((err: unknown) => logger.warn("[RIM:e2ee] group status after joining:", err));
    },
  });
}

/**
 * Decline an invitation: the conversation leaves the inbox. The server tells the viewer they
 * left it, which is no news to them, so the removal toast stays quiet.
 */
export function useDeclineConversationInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationDeclineConversationInviteArgs) => {
      const res = await graphqlClient.request<{ declineConversationInvite: boolean }>(
        DECLINE_CONVERSATION_INVITE,
        vars,
      );
      return res.declineConversationInvite;
    },
    onMutate: (vars) => {
      markLeaving(vars.conversationId);
    },
    onSuccess: (_data, vars) => {
      leaveInvitation(qc, vars.serverId, vars.conversationId);
    },
    onSettled: (_data, _err, vars) => {
      clearLeaving(vars.conversationId);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
    },
  });
}
