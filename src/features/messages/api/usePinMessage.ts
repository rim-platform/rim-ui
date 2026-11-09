import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
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

/**
 * Shows a message as pinned or unpinned in its conversation's cached timeline at once, before
 * the server answers.
 *
 * @returns A function that puts the timeline back as it was, for a pin that failed.
 */
export async function setPinnedInCache(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
  messageId: string,
  pinned: boolean,
): Promise<() => void> {
  const messagesKey = queryKeys.messages(serverId, conversationId);
  await qc.cancelQueries({ queryKey: messagesKey });
  const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);
  qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.map((m) => (m.id === messageId ? { ...m, isPinned: pinned } : m)),
      })),
    };
  });
  return () => {
    if (previousData) qc.setQueryData(messagesKey, previousData);
  };
}

/** Refreshes a conversation's timeline and pinned list once a pin or unpin has ended. */
export function invalidatePinQueries(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.messages(serverId, conversationId) });
  qc.invalidateQueries({ queryKey: queryKeys.pinnedMessages(serverId, conversationId) });
}

function usePinMutation(document: string, pinned: boolean) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: PinMessageVars) =>
      graphqlClient.request(document, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
        },
      }),
    onMutate: async (vars) => ({
      rollback: await setPinnedInCache(
        qc,
        vars.serverId,
        vars.conversationId,
        vars.messageId,
        pinned,
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback();
    },
    onSettled: (_data, _err, vars) => {
      invalidatePinQueries(qc, vars.serverId, vars.conversationId);
    },
  });
}

export function usePinMessageMutation() {
  return usePinMutation(PIN_MESSAGE, true);
}

export function useUnpinMessageMutation() {
  return usePinMutation(UNPIN_MESSAGE, false);
}
