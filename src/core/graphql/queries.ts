import { gql } from "graphql-request";

import { MESSAGE_WITH_REACTIONS } from "../../graphql/fragments/message";

/** The variables of a timeline page read. */
const MESSAGES_VARIABLES = `
    $serverId: ID!
    $conversationId: ID!
    $dir: PageDir!
    $limit: Int!
    $includeDeleted: Boolean!
    $cursor: MessageCursorInput
`;

/** The arguments of `messages` in a timeline page read. */
const MESSAGES_ARGUMENTS = `
      serverId: $serverId
      conversationId: $conversationId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
      cursor: $cursor
`;

/** A timeline page's cursors and page info. */
const MESSAGES_PAGE_INFO = `
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
`;

export const MESSAGES_QUERY = gql`
  query Messages(${MESSAGES_VARIABLES}) {
    messages(${MESSAGES_ARGUMENTS}) {
      items {
        ...MessageWithReactions
      }
      ${MESSAGES_PAGE_INFO}
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

/** The same with `Message.editedAt`, for a server that lists `message_edited_at`. */
export const MESSAGES_WITH_EDITS_QUERY = gql`
  query MessagesWithEdits(${MESSAGES_VARIABLES}) {
    messages(${MESSAGES_ARGUMENTS}) {
      items {
        ...MessageWithReactions
        editedAt
      }
      ${MESSAGES_PAGE_INFO}
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;
