import { gql } from "graphql-request";

import { MESSAGE_WITH_REACTIONS } from "../../graphql/fragments/message";

export const MESSAGES_QUERY = gql`
  query Messages(
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
        ...MessageWithReactions
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
  ${MESSAGE_WITH_REACTIONS}
`;
