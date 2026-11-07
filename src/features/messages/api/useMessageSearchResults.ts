import { useEffect, useMemo } from "react";

import { useChannels, useJoinedChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import { useBlockedConversationIds } from "../../relay/state/useBlockedConversations";
import { requestCacheSync } from "../runtime/messageCacheSync";
import {
  buildConversationDirectory,
  hiddenLocalConversations,
  mergeSearchResults,
} from "./localSearch";
import { useLocalSearchHits, useSearchMessages } from "./useSearchMessages";

/**
 * Message search in one workspace as the person sees it: the server's results, recency
 * ordered, plus, in the desktop app, matches from this device's local index the server did not
 * return; conversations the person blocked are left out. Local hits from a conversation the
 * lists no longer show ask the cache to check that conversation again.
 *
 * @param workspaceId - The workspace searched.
 * @param conversationId - Narrows the search to one conversation.
 * @param query - The text as typed, with operators; it is debounced.
 */
export function useMessageSearchResults(
  workspaceId: string | undefined,
  conversationId: string | undefined,
  query: string,
) {
  const { data: channelsData } = useChannels(workspaceId);
  const { data: joinedData } = useJoinedChannels(workspaceId);
  const { data: inboxData } = useInboxConversations(workspaceId);
  const blocked = useBlockedConversationIds(workspaceId ?? null);
  // The conversations the person can see now: titles for local hits, `in:#name` for local
  // search, and the visibility check before a local hit joins the server's results.
  const directory = useMemo(
    () => buildConversationDirectory([channelsData?.items, joinedData?.items, inboxData?.items]),
    [channelsData, joinedData, inboxData],
  );
  const search = useSearchMessages(workspaceId, conversationId, query, directory);
  const { data: localHits } = useLocalSearchHits(workspaceId, conversationId, query, directory);

  const results = useMemo(
    () =>
      mergeSearchResults(
        search.data?.pages ?? [],
        search.hasNextPage,
        localHits ?? [],
        directory,
      ).filter((m) => !blocked.has(m.conversationId)),
    [search.data, search.hasNextPage, localHits, directory, blocked],
  );
  const isOffline = search.data?.pages.some((page) => page.source === "local") ?? false;

  useEffect(() => {
    if (!workspaceId || !localHits || directory.byId.size === 0) return;
    const hidden = hiddenLocalConversations(localHits, directory);
    if (hidden.length > 0) requestCacheSync(workspaceId, hidden);
  }, [workspaceId, localHits, directory]);

  return { ...search, results, isOffline, directory, channels: channelsData?.items ?? [] };
}
