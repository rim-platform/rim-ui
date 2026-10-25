import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { logger } from "../../../core/logger";
import type { MessageCursor, MessageItem, MessagesPage } from "../../../core/types/messages";
import { REACTION_FIELDS } from "../../../graphql/fragments/message";

/**
 * The server metadata of a timeline page: what the change feed does not version, so a stored
 * copy of it is as of the message's last change.
 */
export const MESSAGE_METADATA_QUERY = gql`
  query MessageMetadata(
    $serverId: ID!
    $conversationId: ID!
    $dir: PageDir!
    $limit: Int!
    $includeDeleted: Boolean!
    $cursor: MessageCursorInput
  ) {
    messages(
      serverId: $serverId
      conversationId: $conversationId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
      cursor: $cursor
    ) {
      items {
        id
        isPinned
        rootThreadId
        reactions {
          ...ReactionFields
        }
      }
    }
  }
  ${REACTION_FIELDS}
`;

export type MessageMetadata = Pick<MessageItem, "id" | "isPinned" | "rootThreadId" | "reactions">;

/**
 * `page` with the reactions, pin and thread of each message the server answered for, matched by
 * id. A message it did not answer for (a tombstone, one not sent yet) keeps its stored ones.
 */
export function withMetadata(page: MessagesPage, metadata: MessageMetadata[]): MessagesPage {
  if (metadata.length === 0) return page;
  const byId = new Map(metadata.map((m) => [m.id, m]));
  return {
    ...page,
    items: page.items.map((item) => {
      const m = byId.get(item.id);
      if (!m) return item;
      return {
        ...item,
        isPinned: m.isPinned,
        rootThreadId: m.rootThreadId ?? null,
        reactions: m.reactions,
      };
    }),
  };
}

/**
 * A timeline page read from this device's store, with the server's current metadata for the same
 * window (`cursor` and `limit` as the store was asked). When the server cannot answer, the page
 * stays as stored.
 */
export async function withServerMetadata(
  workspaceId: string,
  conversationId: string,
  cursor: MessageCursor | null,
  limit: number,
  page: MessagesPage,
): Promise<MessagesPage> {
  if (page.items.length === 0) return page;
  try {
    const res = await graphqlClient.request<{ messages: { items: MessageMetadata[] } }>(
      MESSAGE_METADATA_QUERY,
      {
        serverId: workspaceId,
        conversationId,
        // Older than the cursor, newest page without one: the window the store read.
        dir: "AFTER",
        limit,
        includeDeleted: false,
        ...(cursor ? { cursor } : {}),
      },
    );
    return withMetadata(page, res.messages.items);
  } catch (err) {
    logger.warn("[RIM:cache] reading reactions, pins and threads failed:", err);
    return page;
  }
}
