import { useState, useEffect } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import {
  PageDir,
  type SearchMessagesInput,
  type MessageCursorInput,
  type MessageCursorOutput,
} from "../../../core/graphql/generated/schema-types";

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
   * recency (`sentAt`, `id`), not by rank. See `docs/search-ui.md`.
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
}

interface SearchMessagesResponse {
  searchMessages: SearchResultPage;
}

const SEARCH_PAGE_LIMIT = 25;

/**
 * Debounced (300ms), cursor-paginated full-text message search.
 *
 * Wraps the `searchMessages(input: SearchMessagesInput!): SearchResultPage!`
 * query (Track B1) as a TanStack `useInfiniteQuery`. Pages are ordered by
 * recency (`sentAt DESC, id DESC`), **not** by relevance — `rank` on each
 * item is display-only. See `docs/search-ui.md` and
 * `../rim-server/docs/search.md` for the ranking/pagination rationale and
 * the `from:`/`in:`/`has:`/`before:`/`after:` operator syntax (parsed
 * entirely server-side; this hook passes `query` through unchanged).
 */
export function useSearchMessages(
  workspaceId: string | undefined,
  conversationId: string | undefined,
  query: string,
) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

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
      const res = await graphqlClient.request<SearchMessagesResponse>(SEARCH_MESSAGES_QUERY, {
        input,
      });
      return res.searchMessages;
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
