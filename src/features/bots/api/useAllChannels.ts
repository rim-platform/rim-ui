import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { ChannelCursorOutput } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import type { ConversationSummary } from "../../conversations/types";

/** The most channels the lists in Settings > Bots load. */
export const MAX_LISTED_CHANNELS = 1000;

const CHANNELS_PAGE_QUERY = gql`
  query BotChannels($serverId: ID!, $cursor: ChannelCursorInput) {
    channels(
      serverId: $serverId
      dir: AFTER
      cursor: $cursor
      limit: 100
      filter: { joinedOnly: false, includeArchived: false }
    ) {
      items {
        ...ConversationFields
      }
      next {
        createdAt
        conversationId
      }
      pageInfo {
        hasNext
      }
    }
  }
  ${CONVERSATION_FIELDS}
`;

interface ChannelsPage {
  channels: {
    items: ConversationSummary[];
    next: ChannelCursorOutput | null;
    pageInfo: { hasNext: boolean };
  };
}

/** Every channel the viewer can see, up to {@link MAX_LISTED_CHANNELS}. */
export interface ListedChannels {
  items: ConversationSummary[];
  /** There are more channels than were loaded. */
  truncated: boolean;
}

/**
 * Loads the browse list of channels page by page, up to {@link MAX_LISTED_CHANNELS}, for the
 * channel lists of Settings > Bots. Not fetched in a direct space.
 *
 * @param serverId - The workspace whose channels are listed.
 */
export function useAllChannels(serverId: string | undefined) {
  const direct = useIsDirectSpace(serverId);
  return useQuery({
    // Under the `channels` prefix, so a membership change refreshes it with the other lists.
    queryKey: [...queryKeys.channels(serverId), "all"],
    enabled: Boolean(serverId) && !direct,
    staleTime: 30_000,
    queryFn: async (): Promise<ListedChannels> => {
      const items: ConversationSummary[] = [];
      let cursor: ChannelCursorOutput | null = null;
      for (;;) {
        const res: ChannelsPage = await graphqlClient.request<ChannelsPage>(CHANNELS_PAGE_QUERY, {
          serverId,
          cursor,
        });
        items.push(...res.channels.items);
        cursor = res.channels.next;
        if (!res.channels.pageInfo.hasNext || !cursor) return { items, truncated: false };
        if (items.length >= MAX_LISTED_CHANNELS) {
          return { items: items.slice(0, MAX_LISTED_CHANNELS), truncated: true };
        }
      }
    },
  });
}
