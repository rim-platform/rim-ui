import { gql } from "graphql-request";
import { graphqlClient } from "../../../../core/graphql/client";
import { registerTool } from "../registry";
import { resolveUsernames } from "./memberResolver";

const SEARCH_QUERY = gql`
  query AgentSearchMessages(
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
      conversationId
      conversationTitle
      authorId
      author {
        id
        username
        displayName
      }
      text
      sentAt
    }
  }
`;

interface SearchAuthor {
  id: string;
  username: string;
  displayName: string | null;
}

interface SearchResult {
  id: string;
  conversationId: string;
  conversationTitle: string | null;
  authorId: string;
  author: SearchAuthor | null;
  text: string | null;
  sentAt: string;
}

export function registerSearchMessagesTool(): void {
  registerTool(
    {
      name: "search_messages",
      description:
        "Search for messages across the workspace by text content. " +
        "Returns matching messages with author username, channel name, and timestamp. " +
        "Use this when the user asks to find specific messages or topics.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          query: { type: "string", description: "Search query text" },
          conversation_id: { type: "string", description: "Optional: limit search to a specific channel/conversation" },
          limit: { type: "number", description: "Max results (default 10, max 50)" },
        },
        required: ["workspace_id", "query"],
      },
    },
    async (input) => {
      const workspaceId = input.workspace_id as string;
      const limit = Math.min(Math.max((input.limit as number) || 10, 1), 50);

      const res = await graphqlClient.request<{ searchMessages: SearchResult[] }>(
        SEARCH_QUERY,
        {
          serverId: workspaceId,
          conversationId: (input.conversation_id as string) ?? null,
          query: input.query as string,
          limit,
          includeDeleted: false,
        },
      );

      // Resolve author IDs that don't have inline author data
      const unresolvedIds = [...new Set(
        res.searchMessages.filter((m) => !m.author).map((m) => m.authorId),
      )];
      const usernameMap = unresolvedIds.length > 0
        ? await resolveUsernames(workspaceId, unresolvedIds)
        : new Map<string, string>();

      const results = res.searchMessages.map((m) => ({
        id: m.id,
        channel: m.conversationTitle ?? m.conversationId,
        author: m.author?.displayName || m.author?.username || usernameMap.get(m.authorId) || m.authorId,
        text: m.text,
        sentAt: m.sentAt,
      }));

      return JSON.stringify(results);
    },
  );
}
