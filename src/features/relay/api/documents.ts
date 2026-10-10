/**
 * Every GraphQL document of the relay: what this server is, servers and people on other
 * relays, contacts, the DM request inbox, the relay queue and its subscription, the stream
 * heads a host answers through the forward path, joining workspaces on other hosts and the
 * delegations that keep them flowing, a device revocation's fan-out, and the calls the app
 * makes directly on a host or a new relay.
 */

import { gql } from "graphql-request";

const STATEMENT = "payload signature";

export const RELAY_INFO_QUERY = gql`
  query RelayInfo {
    relayInfo {
      serverId
      roles
      directSpaceId
    }
  }
`;

export const RELAY_ME_QUERY = gql`
  query RelayMe {
    me {
      id
      principalId
    }
  }
`;

export const REMOTE_SERVER_QUERY = gql`
  query RemoteServer($origin: String!) {
    remoteServer(origin: $origin) {
      serverId
      origin
      discovery
    }
  }
`;

export const REMOTE_IDENTITY_QUERY = gql`
  query RemoteIdentity($principalId: String!, $relayUrl: String) {
    remoteIdentity(principalId: $principalId, relayUrl: $relayUrl) {
      principalId
      keyLog { ${STATEMENT} }
      devices {
        deviceId
        certificate { ${STATEMENT} }
        revocation { ${STATEMENT} }
        mlsActive
      }
      card { ${STATEMENT} }
      servedBy
    }
  }
`;

export const CONTACTS_QUERY = gql`
  query Contacts {
    contacts {
      principalId
      relayUrls
      addedAt
    }
  }
`;

const RELAY_ITEM_FIELDS = `
  id
  hostServerId
  workspaceId
  envelope { ${STATEMENT} }
`;

export const DM_REQUESTS_QUERY = gql`
  query DmRequests($status: DmRequestStatus) {
    dmRequests(status: $status) {
      id
      fromPrincipalId
      card { ${STATEMENT} }
      hostServerId
      conversationId
      heldItems { ${RELAY_ITEM_FIELDS} }
      status
      createdAt
      expiresAt
    }
  }
`;

export const RELAY_ITEMS_QUERY = gql`
  query RelayItems($after: ID, $limit: Int) {
    relayItems(after: $after, limit: $limit) {
      items { ${RELAY_ITEM_FIELDS} }
      hasMore
    }
  }
`;

/** Asked of a host through the forward path. */
export const STREAM_HEADS_QUERY = gql`
  query StreamHeads($serverId: ID!, $streams: [String!]!) {
    streamHeads(serverId: $serverId, streams: $streams) {
      stream
      seq
    }
  }
`;

/** A conversation's predecessor, asked separately so a host without it fails only here. */
export const CONVERSATION_PREDECESSOR_QUERY = gql`
  query ConversationPredecessor($serverId: ID!, $conversationId: ID!) {
    conversation(serverId: $serverId, conversationId: $conversationId) {
      id
      memberIds
      predecessor {
        hostServerId
        conversationId
      }
    }
  }
`;

export const ADD_CONTACT_MUTATION = gql`
  mutation AddContact($principalId: String!, $relayUrls: [String!]!) {
    addContact(principalId: $principalId, relayUrls: $relayUrls) {
      principalId
      relayUrls
      addedAt
    }
  }
`;

export const REMOVE_CONTACT_MUTATION = gql`
  mutation RemoveContact($principalId: String!) {
    removeContact(principalId: $principalId)
  }
`;

export const ACCEPT_DM_REQUEST_MUTATION = gql`
  mutation AcceptDmRequest($id: ID!) {
    acceptDmRequest(id: $id) {
      id
      status
    }
  }
`;

export const IGNORE_DM_REQUEST_MUTATION = gql`
  mutation IgnoreDmRequest($id: ID!) {
    ignoreDmRequest(id: $id) {
      id
      status
    }
  }
`;

export const BLOCK_PRINCIPAL_MUTATION = gql`
  mutation BlockPrincipal($principalId: String!) {
    blockPrincipal(principalId: $principalId)
  }
`;

export const UNBLOCK_PRINCIPAL_MUTATION = gql`
  mutation UnblockPrincipal($principalId: String!) {
    unblockPrincipal(principalId: $principalId)
  }
`;

export const REPORT_DM_REQUEST_MUTATION = gql`
  mutation ReportDmRequest($id: ID!, $reason: String!) {
    reportDmRequest(id: $id, reason: $reason)
  }
`;

export const ACK_RELAY_ITEMS_MUTATION = gql`
  mutation AckRelayItems($upTo: ID!) {
    ackRelayItems(upTo: $upTo)
  }
`;

export const LEAVE_RELAY_MUTATION = gql`
  mutation LeaveRelay {
    leaveRelay
  }
`;

export const RELAY_STREAM_SUBSCRIPTION = `
  subscription RelayStream($after: ID) {
    relayStream(after: $after)
  }
`;

export const REMOTE_SUBSCRIPTIONS_QUERY = gql`
  query RemoteSubscriptions {
    remoteSubscriptions {
      hostServerId
      workspaceId
      status
      expiresAt
      reason
    }
  }
`;

export const DEVICE_REVOCATION_STATUS_QUERY = gql`
  query DeviceRevocationStatus($deviceId: ID!) {
    deviceRevocationStatus(deviceId: $deviceId) {
      hostServerId
      status
      ack { ${STATEMENT} }
      attempts
    }
  }
`;

export const REMOTE_JOIN_CHALLENGE_MUTATION = gql`
  mutation RemoteJoinChallenge($hostServerId: String!, $hostOrigin: String!, $inviteToken: String) {
    remoteJoinChallenge(
      hostServerId: $hostServerId
      hostOrigin: $hostOrigin
      inviteToken: $inviteToken
    ) {
      challengeId
      nonce
      expiresAt
      workspaceId
    }
  }
`;

export const JOIN_REMOTE_WORKSPACE_MUTATION = gql`
  mutation JoinRemoteWorkspace($input: JoinRemoteWorkspaceInput!) {
    joinRemoteWorkspace(input: $input) {
      hostServerId
      workspaceId
      userId
      role
    }
  }
`;

export const RENEW_DELEGATIONS_MUTATION = gql`
  mutation RenewDelegations($delegations: [SignedStatementInput!]!) {
    renewDelegations(delegations: $delegations) {
      hostServerId
      workspaceId
      status
      expiresAt
      reason
    }
  }
`;

/** Sent to a host directly: no session, no CSRF header. */
export const APPLY_REMOTE_REVOCATION_MUTATION = gql`
  mutation ApplyRemoteRevocation($revocation: SignedStatementInput!) {
    applyRemoteRevocation(revocation: $revocation) {
      ${STATEMENT}
    }
  }
`;

/** A workspace's name, asked of its host through the forward path. */
export const REMOTE_WORKSPACE_QUERY = gql`
  query RemoteWorkspace($serverId: ID!) {
    server(serverId: $serverId) {
      id
      name
    }
  }
`;

/** Sent to a server directly, to sign in there with this device's key. */
export const KEY_LOGIN_CHALLENGE_MUTATION = gql`
  mutation KeyLoginChallenge {
    keyLoginChallenge {
      challengeId
      nonce
    }
  }
`;

/** Sent to a server directly, with a proof whose audience is that server's id. */
export const LOGIN_WITH_KEY_MUTATION = gql`
  mutation LoginWithKey($proof: SignedStatementInput!) {
    loginWithKey(proof: $proof) {
      userId
    }
  }
`;

/** Sent to a new relay directly, to open an account there with this identity. */
export const SIGNUP_WITH_KEY_MUTATION = gql`
  mutation SignupWithKey($input: SignupWithKeyInput!) {
    signupWithKey(input: $input) {
      userId
    }
  }
`;

/** Sent to a new relay directly, to publish this person's card there. */
export const PUBLISH_PROFILE_CARD_MUTATION = gql`
  mutation PublishProfileCard($card: SignedStatementInput!) {
    publishProfileCard(card: $card) {
      version
    }
  }
`;

/** A host's events on its own WebSocket, for a direct connection. */
export const WORKSPACE_EVENTS_SUBSCRIPTION = `
  subscription WorkspaceEvents($workspaceId: ID!) {
    workspaceEvents(workspaceId: $workspaceId)
  }
`;

/** A page of a direct space's conversations, newest activity first. */
export const DIRECT_SPACE_CONVERSATIONS_QUERY = gql`
  query DirectSpaceConversations($serverId: ID!, $cursor: InboxCursorInput) {
    inboxConversations(serverId: $serverId, dir: BEFORE, cursor: $cursor, limit: 100) {
      items {
        id
      }
      next {
        lastActivityAt
        conversationId
      }
      pageInfo {
        hasNext
      }
    }
  }
`;
