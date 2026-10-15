import { queryOptions, useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import { withOfflineSnapshot } from "../../offline/api/offlineSnapshot";
import type { ConversationSummaryPage } from "../types";

const INBOX_CONVERSATIONS_QUERY = gql`
  query InboxConversations($serverId: ID!, $dir: PageDir!, $limit: Int!) {
    inboxConversations(serverId: $serverId, dir: $dir, limit: $limit) {
      items {
        ...ConversationFields
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${CONVERSATION_FIELDS}
`;

interface InboxConversationsResponse {
  inboxConversations: ConversationSummaryPage;
}

/** A space's DMs and groups, newest first; the desktop app keeps a copy for offline starts. */
export function fetchInboxConversations(workspaceId: string): Promise<ConversationSummaryPage> {
  return withOfflineSnapshot("inbox", workspaceId, async () => {
    const res = await graphqlClient.request<InboxConversationsResponse>(INBOX_CONVERSATIONS_QUERY, {
      serverId: workspaceId,
      dir: "AFTER",
      limit: 50,
    });
    return res.inboxConversations;
  });
}

/**
 * The inbox query's options. The list is read again when the window regains focus: an
 * invitation that expired leaves it without an event.
 */
export function inboxQueryOptions(workspaceId?: string) {
  return queryOptions({
    queryKey: queryKeys.conversations(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    networkMode: "offlineFirst",
    refetchOnWindowFocus: true,
    queryFn: () => fetchInboxConversations(workspaceId!),
  });
}

/** The sidebar's DMs. The desktop app keeps a copy for offline starts (offlineSnapshot.ts). */
export function useInboxConversations(workspaceId?: string) {
  return useQuery(inboxQueryOptions(workspaceId));
}
