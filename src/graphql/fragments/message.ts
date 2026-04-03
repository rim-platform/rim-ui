import { gql } from "graphql-request";

export const ATTACHMENT_FIELDS = gql`
  fragment AttachmentFields on Attachment {
    id
    filename
    contentType
    sizeBytes
    status
  }
`;

export const MESSAGE_FIELDS = gql`
  fragment MessageFields on Message {
    id
    serverId
    conversationId
    threadId
    rootThreadId
    authorId
    author {
      id
      username
      displayName
      avatarUrl
    }
    text
    hasAttachments
    parentMessageId
    isDeleted
    sentAt
    attachments {
      ...AttachmentFields
    }
  }
  ${ATTACHMENT_FIELDS}
`;

export const REACTION_FIELDS = gql`
  fragment ReactionFields on ReactionGroup {
    emoji
    count
    reactedByMe
    userIds
  }
`;

export const MESSAGE_WITH_REACTIONS = gql`
  fragment MessageWithReactions on Message {
    ...MessageFields
    reactions {
      ...ReactionFields
    }
  }
  ${MESSAGE_FIELDS}
  ${REACTION_FIELDS}
`;
