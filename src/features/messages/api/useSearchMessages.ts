import { useCallback, useState, useEffect } from "react";
import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import {
  PageDir,
  type SearchMessagesInput,
  type MessageCursorInput,
  type MessageCursorOutput,
} from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  localHitToSearchItem,
  localPageToSearchPage,
  parseLocalSearchQuery,
  type ConversationDirectory,
} from "./localSearch";
import {
  currentCacheAccount,
  isServerUnreachable,
  searchCachedMessages,
  type LocalSearchHit,
} from "./messageCache";

const SEARCH_MESSAGES_QUERY = gql`
  query SearchMessages($input: SearchMessagesInput!) {
    searchMessages(input: $input) {
      items {
        id
        serverId
        conversationId
        conversationTitle
        conversationType
        threadId
        rootMessageId
        authorId
        author {
          id
          username
          displayName
          avatarUrl
        }
        text
        sentAt
        rank
        headline
      }
      next {
        sentAt
        messageId
      }
      prev {
        sentAt
        messageId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

export interface SearchMessageAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SearchMessageItem {
  id: string;
  serverId: string;
  conversationId: string;
  conversationTitle: string | null;
  conversationType: string;
  threadId: string | null;
  authorId: string;
  author: SearchMessageAuthor | null;
  text: string | null;
  sentAt: string;
  rootMessageId: string | null;
  /**
   * `ts_rank` relevance score. Display-only — results are paginated by
   * recency (`sentAt`, `id`), not by rank.
   */
  rank: number;
  /**
   * `ts_headline` snippet with literal `<mark>…</mark>` highlights around
   * matched terms, or `null` for a purely operator-based query (no
   * free-text component). Render via `SearchSnippet`, never directly —
   * the surrounding text is raw user content and must be sanitized.
   */
  headline: string | null;
}

export interface SearchResultPage {
  items: SearchMessageItem[];
  next: MessageCursorOutput | null;
  prev: MessageCursorOutput | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
  /** `"local"`: the server could not be reached and this page came from the local index. */
  source?: "local";
}

interface SearchMessagesResponse {
  searchMessages: SearchResultPage;
}

const SEARCH_PAGE_LIMIT = 25;
/** Local hits fetched to add to online results: the newest this many. */
const LOCAL_SUPPLEMENT_LIMIT = 100;
const EMPTY_DIRECTORY: ConversationDirectory = { byId: new Map(), idByName: new Map() };

/** The query as typed, once it has been still for 300ms. */
function useDebouncedQuery(query: string): string {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return debouncedQuery;
}

/**
 * Debounced (300ms), cursor-paginated full-text message search.
 *
 * Wraps the `searchMessages(input: SearchMessagesInput!): SearchResultPage!`
 * query as a TanStack `useInfiniteQuery`. Pages are ordered by recency
 * (`sentAt DESC, id DESC`), **not** by relevance — `rank` on each item is
 * display-only. The `from:`/`in:`/`has:`/`before:`/`after:` operators are
 * parsed server-side; this hook passes `query` through unchanged.
 *
 * On the desktop app, a page the server cannot be reached for comes from the local search
 * index instead, with the same cursor, marked `source: "local"`; `directory` resolves
 * `in:#name` and conversation titles for it.
 */
export function useSearchMessages(
  workspaceId: string | undefined,
  conversationId: string | undefined,
  query: string,
  directory: ConversationDirectory = EMPTY_DIRECTORY,
) {
  const debouncedQuery = useDebouncedQuery(query);

  return useInfiniteQuery({
    queryKey: queryKeys.searchMessages(workspaceId, conversationId ?? "__all__", debouncedQuery),
    enabled: Boolean(workspaceId && debouncedQuery.trim()),
    staleTime: 15_000,
    initialPageParam: undefined as MessageCursorInput | undefined,
    queryFn: async ({ pageParam }) => {
      const input: SearchMessagesInput = {
        serverId: workspaceId!,
        query: debouncedQuery.trim(),
        conversationId,
        limit: SEARCH_PAGE_LIMIT,
        dir: PageDir.AFTER,
        cursor: pageParam,
      };
      try {
        const res = await graphqlClient.request<SearchMessagesResponse>(SEARCH_MESSAGES_QUERY, {
          input,
        });
        return res.searchMessages;
      } catch (err) {
        const account = isServerUnreachable(err) ? currentCacheAccount() : null;
        if (account) {
          const local = parseLocalSearchQuery(input.query, conversationId, directory);
          if (!local) return localPageToSearchPage({ items: [], hasMore: false }, directory);
          const page = await searchCachedMessages(
            account,
            input.serverId,
            local,
            pageParam ?? null,
            SEARCH_PAGE_LIMIT,
          );
          if (page) return localPageToSearchPage(page, directory);
        }
        throw err;
      }
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.pageInfo.hasNext && lastPage.next) {
        return lastPage.next;
      }
      return undefined;
    },
  });
}

/**
 * Flattens all loaded pages of a {@link useSearchMessages} result into a
 * single recency-ordered list, for consumers (the search overlay) that want
 * a flat list rather than TanStack's page-array shape.
 */
export function flattenSearchPages(
  data: InfiniteData<SearchResultPage> | undefined,
): SearchMessageItem[] {
  if (!data) return [];
  return data.pages.flatMap((page) => page.items);
}

/**
 * The newest local-index hits for the query (desktop app only), to add to the server's results
 * with `mergeSearchResults`. Empty in the web app or when the cache cannot answer.
 */
export function useLocalSearchHits(
  workspaceId: string | undefined,
  conversationId: string | undefined,
  query: string,
  directory: ConversationDirectory,
) {
  const debouncedQuery = useDebouncedQuery(query);
  const userId = useAuthStore((s) => s.session?.userId);
  const parsed = workspaceId
    ? parseLocalSearchQuery(debouncedQuery, conversationId, directory)
    : null;
  // Titles come from the lists as they are now, not as they were when the hits were fetched.
  const toItems = useCallback(
    (hits: LocalSearchHit[]) => hits.map((hit) => localHitToSearchItem(hit, directory)),
    [directory],
  );

  return useQuery({
    // Keyed by the parsed query, so an `in:#name` the lists resolve differently fetches again.
    queryKey: queryKeys.localSearchMessages(
      workspaceId,
      userId,
      conversationId ?? "__all__",
      JSON.stringify(parsed),
    ),
    enabled: Boolean(parsed && userId && currentCacheAccount()),
    staleTime: 5_000,
    retry: false,
    queryFn: async (): Promise<LocalSearchHit[]> => {
      const account = currentCacheAccount();
      if (!account || !parsed || !workspaceId) return [];
      const page = await searchCachedMessages(
        account,
        workspaceId,
        parsed,
        null,
        LOCAL_SUPPLEMENT_LIMIT,
      );
      return page?.items ?? [];
    },
    select: toItems,
  });
}
