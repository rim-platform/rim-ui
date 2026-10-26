import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { Message } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const THREAD_REPLY_COUNT_QUERY = gql`
  query ThreadReplyCount($serverId: ID!, $conversationId: ID!, $messageId: ID!) {
    message(serverId: $serverId, conversationId: $conversationId, messageId: $messageId) {
      id
      threadReplyCount
    }
  }
`;

interface ThreadReplyCountResponse {
  message: Pick<Message, "id" | "threadReplyCount">;
}

/**
 * How many replies a thread has, asked for its root apart from the timeline so an older
 * server's refusal of the field leaves every other message query working.
 *
 * @param enabled Whether to ask at all: only for a thread's root that is not deleted.
 * @returns The count, or null while it is asked, when the server refuses the query (an older
 *   server) and when the server reports none.
 */
export function useThreadReplyCount(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
  rootMessageId: string | null | undefined,
  enabled: boolean,
): number | null {
  const ws = workspaceId ?? undefined;
  const conv = conversationId ?? undefined;
  const root = rootMessageId ?? undefined;
  const query = useQuery({
    queryKey: queryKeys.threadReplyCount(ws, conv, root),
    enabled: enabled && Boolean(ws && conv && root),
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ThreadReplyCountResponse>(THREAD_REPLY_COUNT_QUERY, {
        serverId: ws,
        conversationId: conv,
        messageId: root,
      });
      return res.message.threadReplyCount ?? null;
    },
  });
  return query.data ?? null;
}
