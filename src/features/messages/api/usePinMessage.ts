import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../../core/types/messages";

const PIN_MESSAGE = gql`
  mutation PinMessage($input: PinMessageInput!) {
    pinMessage(input: $input)
  }
`;

const UNPIN_MESSAGE = gql`
  mutation UnpinMessage($input: UnpinMessageInput!) {
    unpinMessage(input: $input)
  }
`;

interface PinMessageVars {
  serverId: string;
  conversationId: string;
  messageId: string;
}

export function usePinMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: PinMessageVars) =>
      graphqlClient.request(PIN_MESSAGE, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
        },
      }),
    onMutate: async (vars) => {
      const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
      await qc.cancelQueries({ queryKey: messagesKey });
      const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => (m.id === vars.messageId ? { ...m, isPinned: true } : m)),
          })),
        };
      });
      return { previousData };
    },
    onError: (_err, vars, context) => {
      if (context?.previousData) {
        qc.setQueryData(
          queryKeys.messages(vars.serverId, vars.conversationId),
          context.previousData,
        );
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
      qc.invalidateQueries({
        queryKey: queryKeys.pinnedMessages(vars.serverId, vars.conversationId),
      });
    },
  });
}

export function useUnpinMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: PinMessageVars) =>
      graphqlClient.request(UNPIN_MESSAGE, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
        },
      }),
    onMutate: async (vars) => {
      const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
      await qc.cancelQueries({ queryKey: messagesKey });
      const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => (m.id === vars.messageId ? { ...m, isPinned: false } : m)),
          })),
        };
      });
      return { previousData };
    },
    onError: (_err, vars, context) => {
      if (context?.previousData) {
        qc.setQueryData(
          queryKeys.messages(vars.serverId, vars.conversationId),
          context.previousData,
        );
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
      qc.invalidateQueries({
        queryKey: queryKeys.pinnedMessages(vars.serverId, vars.conversationId),
      });
    },
  });
}
