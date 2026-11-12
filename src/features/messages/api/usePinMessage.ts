import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../../core/types/messages";

const UNPIN_MESSAGE = gql`
  mutation UnpinMessage($input: UnpinMessageInput!) {
    unpinMessage(input: $input)
  }
`;

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

/**
 * Unpins a message with the `unpinMessage` mutation, for a server that does not list
 * `chat.unpin_message`: the timeline shows it unpinned at once, goes back on a failure, and the
 * pinned list is refreshed once the server answered.
 *
 * @throws The request's error when the server refused the unpin.
 */
export async function unpinWithMutation(
  qc: QueryClient,
  vars: { serverId: string; conversationId: string; messageId: string },
): Promise<void> {
  const rollback = await setPinnedInCache(
    qc,
    vars.serverId,
    vars.conversationId,
    vars.messageId,
    false,
  );
  try {
    await graphqlClient.request(UNPIN_MESSAGE, { input: vars });
  } catch (err) {
    rollback();
    throw err;
  } finally {
    invalidatePinQueries(qc, vars.serverId, vars.conversationId);
  }
}
