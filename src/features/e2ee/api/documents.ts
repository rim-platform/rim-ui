/**
 * Every GraphQL document of end-to-end encryption, in one place: the key packages, the group
 * a conversation has on the server, Commits, Welcomes, envelopes, re-add requests and the
 * device lists leaves are checked against.
 */

import { gql } from "graphql-request";

import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";

export const MLS_GROUP_FIELDS = gql`
  fragment MlsGroupFields on MlsGroup {
    groupId
    incarnation
    cipherSuite
    epoch
    devices {
      userId
      principalId
      deviceId
      addedEpoch
    }
    pendingAdds {
      userId
      principalId
      deviceId
      hasKeyPackage
    }
    pendingRemoves {
      userId
      principalId
      deviceId
      addedEpoch
    }
    readdRequests {
      principalId
      deviceId
      request {
        payload
        signature
      }
      createdAt
    }
  }
`;

export const CONVERSATION_GROUP_QUERY = gql`
  query ConversationGroup($serverId: ID!, $conversationId: ID!) {
    conversation(serverId: $serverId, conversationId: $conversationId) {
      id
      conversationType
      memberIds
      createdBy
      encryptedAt
      mlsGroup {
        ...MlsGroupFields
      }
    }
  }
  ${MLS_GROUP_FIELDS}
`;

export const MY_KEY_PACKAGE_STATUS_QUERY = gql`
  query MyMlsKeyPackageStatus {
    myMlsKeyPackageStatus {
      cipherSuite
      available
      lastResortNotAfter
      lastResortClaims
    }
  }
`;

export const UPLOAD_KEY_PACKAGES_MUTATION = gql`
  mutation UploadMlsKeyPackages($keyPackages: [String!]!) {
    uploadMlsKeyPackages(keyPackages: $keyPackages) {
      cipherSuite
      available
    }
  }
`;

export const CLAIM_KEY_PACKAGES_MUTATION = gql`
  mutation ClaimMlsKeyPackages($input: ClaimMlsKeyPackagesInput!) {
    claimMlsKeyPackages(input: $input) {
      userId
      principalId
      deviceId
      keyPackage
      keyPackageRef
      lastResort
    }
  }
`;

export const SUBMIT_COMMIT_MUTATION = gql`
  mutation SubmitMlsCommit($input: SubmitMlsCommitInput!) {
    submitMlsCommit(input: $input) {
      id
      incarnation
      epoch
    }
  }
`;

export const MLS_COMMITS_QUERY = gql`
  query MlsCommits(
    $serverId: ID!
    $conversationId: ID!
    $incarnation: Int!
    $afterEpoch: Int
    $limit: Int
  ) {
    mlsCommits(
      serverId: $serverId
      conversationId: $conversationId
      incarnation: $incarnation
      afterEpoch: $afterEpoch
      limit: $limit
    ) {
      commits {
        id
        incarnation
        epoch
        senderPrincipalId
        senderDeviceId
        message
      }
      hasMore
    }
  }
`;

export const MY_WELCOMES_QUERY = gql`
  query MyMlsWelcomes($after: MlsWelcomeCursorInput, $limit: Int) {
    myMlsWelcomes(after: $after, limit: $limit) {
      id
      serverId
      conversationId
      incarnation
      epoch
      message
      createdAt
    }
  }
`;

export const ACK_WELCOMES_MUTATION = gql`
  mutation AckMlsWelcomes($ids: [ID!]!) {
    ackMlsWelcomes(ids: $ids)
  }
`;

export const PRINCIPAL_DEVICES_QUERY = gql`
  query PrincipalDevices($principalIds: [String!]!) {
    principalDevices(principalIds: $principalIds) {
      principalId
      devices {
        deviceId
        name
        certificate {
          payload
          signature
        }
        revokedAt
        revocation {
          payload
          signature
        }
        mlsActive
      }
    }
  }
`;

export const SEND_ENCRYPTED_MESSAGE_MUTATION = gql`
  mutation SendEncryptedMessage($input: SendEncryptedMessageInput!) {
    sendEncryptedMessage(input: $input) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

export const EDIT_ENCRYPTED_MESSAGE_MUTATION = gql`
  mutation EditEncryptedMessage($input: EditEncryptedMessageInput!) {
    editEncryptedMessage(input: $input) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

export const REQUEST_READD_MUTATION = gql`
  mutation RequestMlsReadd($input: RequestMlsReaddInput!) {
    requestMlsReadd(input: $input)
  }
`;

export const THREAD_ROOT_QUERY = gql`
  query ThreadRoot($serverId: ID!, $conversationId: ID!, $threadId: ID!) {
    thread(serverId: $serverId, conversationId: $conversationId, threadId: $threadId) {
      id
      rootMessageId
    }
  }
`;

export const MESSAGE_ATTACHMENTS_QUERY = gql`
  query MessageAttachments($serverId: ID!, $conversationId: ID!, $messageId: ID!) {
    message(serverId: $serverId, conversationId: $conversationId, messageId: $messageId) {
      id
      attachments {
        id
        status
        sizeBytes
        blobSha256
      }
    }
  }
`;
