import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const SEARCH_MESSAGES_QUERY = gql`
  query SearchMessages(
    $serverId: ID!
    $conversationId: ID
    $query: String!
    $limit: Int!
    $includeDeleted: Boolean!
  ) {
    searchMessages(
      serverId: $serverId
      conversationId: $conversationId
      query: $query
      limit: $limit
      includeDeleted: $includeDeleted
    ) {
      id
      serverId
      conversationId
      conversationTitle
      conversationType
      threadId
      authorId
      author {
        id
        username
        displayName
        avatarUrl
      }
      text
      sentAt
      rootMessageId
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
}

interface SearchMessagesResponse {
  searchMessages: SearchMessageItem[];
}

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

  return useQuery({
    queryKey: queryKeys.searchMessages(workspaceId, conversationId ?? "__all__", debouncedQuery),
    enabled: Boolean(workspaceId && debouncedQuery.trim()),
    staleTime: 15_000,
    queryFn: async () => {
      const res = await graphqlClient.request<SearchMessagesResponse>(
        SEARCH_MESSAGES_QUERY,
        {
          serverId: workspaceId!,
          conversationId: conversationId ?? null,
          query: debouncedQuery.trim(),
          limit: 50,
          includeDeleted: false,
        },
      );
      return res.searchMessages;
    },
  });
}
