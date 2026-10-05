import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { ChannelListFilter } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import type { ConversationSummaryPage } from "../types";

const ChannelsDocument = gql`
  query Channels($serverId: ID!, $dir: PageDir!, $limit: Int!, $filter: ChannelListFilter) {
    channels(serverId: $serverId, dir: $dir, limit: $limit, filter: $filter) {
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

/** Every channel the viewer can see that is not archived: the browse list. */
const BROWSE_FILTER: ChannelListFilter = { joinedOnly: false, includeArchived: false };

/** Channels the viewer has joined, archived ones included: the sidebar list. */
const JOINED_FILTER: ChannelListFilter = { joinedOnly: true, includeArchived: true };

async function fetchChannels(serverId: string, filter: ChannelListFilter) {
  const res = await graphqlClient.request<{ channels: ConversationSummaryPage }>(ChannelsDocument, {
    serverId,
    dir: "AFTER",
    limit: 100,
    filter,
  });
  return res.channels;
}

/**
 * Every channel the viewer can see that is not archived: public channels (joined or not) plus
 * the private channels they belong to. Backs the browse dialog and the channel pickers.
 */
export function useChannels(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.channels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: () => fetchChannels(workspaceId!, BROWSE_FILTER),
  });
}

/** Channels the viewer has joined, archived ones included. Backs the sidebar. */
export function useJoinedChannels(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.joinedChannels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: () => fetchChannels(workspaceId!, JOINED_FILTER),
  });
}
