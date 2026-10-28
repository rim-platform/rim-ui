import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { graphqlClient } from "../graphql/client";
import { queryKeys } from "../query/keys";
import { MESSAGES_QUERY, MESSAGES_WITH_EDITS_QUERY } from "../graphql/queries";
import {
  MESSAGE_EDITED_AT,
  serverHasCapability,
} from "../../features/updater/api/serverCapabilities";

interface MessagesResponse {
  messages: {
    items: unknown[];
    next: unknown;
    prev: unknown;
    pageInfo: { hasNext: boolean; hasPrev: boolean };
  };
}

export function usePrefetchMessages(workspaceId: string | null, conversationIds: string[]) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId || conversationIds.length === 0) return;

    for (const convId of conversationIds) {
      const queryKey = queryKeys.messages(workspaceId, convId);

      // Only a conversation the cache has no query for: no data, and no load under way (the open
      // timeline's included, whose own read may come from the encrypted store).
      if (qc.getQueryState(queryKey)) continue;

      qc.prefetchInfiniteQuery({
        queryKey,
        queryFn: async () => {
          const document = (await serverHasCapability(MESSAGE_EDITED_AT))
            ? MESSAGES_WITH_EDITS_QUERY
            : MESSAGES_QUERY;
          const res = await graphqlClient.request<MessagesResponse>(document, {
            serverId: workspaceId,
            conversationId: convId,
            // Must match useConversationMessages: AFTER is "older" on this DESC endpoint.
            dir: "AFTER",
            limit: 50,
            includeDeleted: false,
          });
          return res.messages;
        },
        initialPageParam: null,
      });
    }
  }, [workspaceId, conversationIds.join(","), qc]);
}
