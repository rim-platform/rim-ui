import { gql } from "graphql-request";

export const CONVERSATION_FIELDS = gql`
  fragment ConversationFields on Conversation {
    id
    serverId
    title
    conversationType
    memberIds
    topic
    isPrivate
    isArchived
    archivedAt
    memberCount
    isMember
    createdBy
    slowModeSeconds
  }
`;
