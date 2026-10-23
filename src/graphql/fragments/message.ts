import { gql } from "graphql-request";

export const ATTACHMENT_FIELDS = gql`
  fragment AttachmentFields on Attachment {
    id
    filename
    contentType
    sizeBytes
    status
    blobSha256
  }
`;

/** The envelope facts of an encrypted message, without the ciphertext (the feed asks for it). */
export const ENCRYPTION_FIELDS = gql`
  fragment EncryptionFields on MessageEncryption {
    incarnation
    epoch
    senderDeviceId
    frankingReceipt
    frankingKeyId
    sentAtUs
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
      principalId
      handle
      banned
      bannedUntil
      banReason
    }
    text
    hasAttachments
    parentMessageId
    isPinned
    isDeleted
    mentionedUserIds
    forwardedFromMessageId
    forwardedFrom {
      id
      conversationId
      author {
        id
        username
        displayName
      }
    }
    sentAt
    attachments {
      ...AttachmentFields
    }
    linkPreviews {
      id
      url
      title
      description
      imageUrl
      siteName
    }
    encryption {
      ...EncryptionFields
    }
  }
  ${ATTACHMENT_FIELDS}
  ${ENCRYPTION_FIELDS}
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
