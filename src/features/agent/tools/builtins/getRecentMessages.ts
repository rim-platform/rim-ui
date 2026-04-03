import { gql } from "graphql-request";
import { graphqlClient } from "../../../../core/graphql/client";
import { registerTool } from "../registry";
import { resolveUsernames } from "./memberResolver";

const RECENT_MESSAGES_QUERY = gql`
  query AgentRecentMessages($serverId: ID!, $conversationId: ID!, $limit: Int!) {
    messages(serverId: $serverId, conversationId: $conversationId, limit: $limit) {
      items {
        id
        authorId
        author {
          id
          username
          displayName
        }
        text
        sentAt
        isDeleted
      }
    }
  }
`;

interface MessageAuthor {
  id: string;
  username: string;
  displayName: string | null;
}

interface MessageItem {
  id: string;
  authorId: string;
  author: MessageAuthor | null;
  text: string | null;
  sentAt: string;
  isDeleted: boolean;
}

export function registerGetRecentMessagesTool(): void {
  registerTool(
    {
      name: "get_recent_messages",
      description:
        "Get the most recent messages from a specific channel/conversation. " +
        "Returns messages with author usernames and timestamps. " +
        "Use this to read conversation history, summarize discussions, or find who said what.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          conversation_id: { type: "string", description: "The channel/conversation ID to get messages from" },
          limit: {
            type: "number",
            description: "Number of messages to fetch (default 30, max 100). Use higher values when user asks for summaries.",
          },
        },
        required: ["workspace_id", "conversation_id"],
      },
    },
    async (input) => {
      const workspaceId = input.workspace_id as string;
      const requestedLimit = Math.min(Math.max((input.limit as number) || 30, 1), 100);

      // Backend may cap at 50 per page — fetch multiple pages if needed
      const allMessages: MessageItem[] = [];
      let cursor: string | null = null;
      let remaining = requestedLimit;

      while (remaining > 0) {
        const batchSize = Math.min(remaining, 50);
        const variables: Record<string, unknown> = {
          serverId: workspaceId,
          conversationId: input.conversation_id as string,
          limit: batchSize,
        };
        if (cursor) {
          variables.before = cursor;
        }

        const res = await graphqlClient.request<{ messages: { items: MessageItem[] } }>(
          RECENT_MESSAGES_QUERY,
          variables,
        );

        const items = res.messages.items;
        if (items.length === 0) break;

        allMessages.push(...items);
        remaining -= items.length;

        // If we got fewer than requested, no more pages
        if (items.length < batchSize) break;

        // Use last item's sentAt as cursor for next page
        cursor = items[items.length - 1].sentAt;
      }

      // Resolve author IDs that don't have inline author data
      const unresolvedIds = [...new Set(
        allMessages.filter((m) => !m.author).map((m) => m.authorId),
      )];
      const usernameMap = unresolvedIds.length > 0
        ? await resolveUsernames(workspaceId, unresolvedIds)
        : new Map<string, string>();

      const messages = allMessages
        .filter((m) => !m.isDeleted)
        .map((m) => ({
          author: m.author?.displayName || m.author?.username || usernameMap.get(m.authorId) || m.authorId,
          text: m.text,
          sentAt: m.sentAt,
        }));

      return JSON.stringify(messages);
    },
  );
}
