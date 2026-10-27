/**
 * The relay's server calls. Calls about a space on another server (`streamHeads`, a
 * conversation's predecessor) carry its id in `serverId`, so the GraphQL client sends them to
 * its host through the relay.
 */

import { graphqlClient } from "../../../core/graphql/client";
import type {
  BlockedPrincipal,
  Contact,
  DmRequestStatus,
  JoinRemoteWorkspaceInput,
  RelayItemPage,
  RemoteJoinChallenge,
  RemoteJoinResult,
  RemoteSubscription,
  RevocationFanoutStatus,
  SignedStatement,
  SignedStatementInput,
} from "../../../core/graphql/generated/schema-types";
import { ownerName } from "../../workspaces/workspaceLabel";
import type { RelayInfo } from "../state/useRelayStore";
import {
  ACCEPT_DM_REQUEST_MUTATION,
  ACK_RELAY_ITEMS_MUTATION,
  ADD_CONTACT_MUTATION,
  BLOCK_PRINCIPAL_MUTATION,
  CONTACTS_QUERY,
  CONVERSATION_PREDECESSOR_QUERY,
  DEVICE_REVOCATION_STATUS_QUERY,
  DM_REQUESTS_QUERY,
  IGNORE_DM_REQUEST_MUTATION,
  JOIN_REMOTE_WORKSPACE_MUTATION,
  MY_BLOCKED_PRINCIPALS_QUERY,
  RELAY_INFO_QUERY,
  RELAY_ITEMS_QUERY,
  RELAY_ME_QUERY,
  REMOTE_IDENTITY_QUERY,
  REMOTE_JOIN_CHALLENGE_MUTATION,
  REMOTE_SERVER_QUERY,
  REMOTE_SUBSCRIPTIONS_QUERY,
  REMOTE_WORKSPACE_OWNER_QUERY,
  REMOTE_WORKSPACE_QUERY,
  REMOVE_CONTACT_MUTATION,
  RENEW_DELEGATIONS_MUTATION,
  REPORT_DM_REQUEST_MUTATION,
  STREAM_HEADS_QUERY,
  UNBLOCK_PRINCIPAL_MUTATION,
} from "./documents";

type StatementOnly = Pick<SignedStatement, "payload" | "signature">;

/** A relay queue item as the API returns it. */
export interface RelayItemView {
  id: string;
  hostServerId: string;
  workspaceId: string;
  envelope: StatementOnly;
}

/** `remoteIdentity`: everything a person's relay serves about them. */
export interface RemoteIdentityView {
  principalId: string;
  keyLog: StatementOnly[];
  devices: {
    deviceId: string;
    certificate: StatementOnly;
    revocation: StatementOnly | null;
    mlsActive: boolean;
  }[];
  card: StatementOnly | null;
  servedBy: string;
}

export type ContactView = Pick<Contact, "principalId" | "relayUrls" | "addedAt">;

export interface DmRequestView {
  id: string;
  fromPrincipalId: string;
  card: StatementOnly;
  hostServerId: string;
  conversationId: string;
  heldItems: RelayItemView[];
  status: DmRequestStatus;
  createdAt: string;
  expiresAt: string;
}

export async function fetchRelayInfo(): Promise<RelayInfo> {
  const res = await graphqlClient.request<{ relayInfo: RelayInfo }>(RELAY_INFO_QUERY);
  return res.relayInfo;
}

export async function fetchRelayMe(): Promise<{ id: string; principalId: string | null }> {
  const res = await graphqlClient.request<{ me: { id: string; principalId: string | null } }>(
    RELAY_ME_QUERY,
  );
  return res.me;
}

/** The discovery document of the server at `origin`, fetched by the relay. */
export async function fetchRemoteServer(
  origin: string,
): Promise<{ serverId: string; origin: string; discovery: string }> {
  const res = await graphqlClient.request<{
    remoteServer: { serverId: string; origin: string; discovery: string };
  }>(REMOTE_SERVER_QUERY, { origin });
  return res.remoteServer;
}

export async function fetchRemoteIdentity(
  principalId: string,
  relayUrl: string | null,
): Promise<RemoteIdentityView> {
  const res = await graphqlClient.request<{ remoteIdentity: RemoteIdentityView }>(
    REMOTE_IDENTITY_QUERY,
    { principalId, relayUrl },
  );
  return res.remoteIdentity;
}

export async function fetchContacts(): Promise<ContactView[]> {
  const res = await graphqlClient.request<{ contacts: ContactView[] }>(CONTACTS_QUERY);
  return res.contacts;
}

export async function addContact(principalId: string, relayUrls: string[]): Promise<ContactView> {
  const res = await graphqlClient.request<{ addContact: ContactView }>(ADD_CONTACT_MUTATION, {
    principalId,
    relayUrls,
  });
  return res.addContact;
}

export async function removeContact(principalId: string): Promise<void> {
  await graphqlClient.request(REMOVE_CONTACT_MUTATION, { principalId });
}

export async function fetchDmRequests(status: DmRequestStatus | null): Promise<DmRequestView[]> {
  const res = await graphqlClient.request<{ dmRequests: DmRequestView[] }>(DM_REQUESTS_QUERY, {
    status,
  });
  return res.dmRequests;
}

export async function acceptDmRequest(id: string): Promise<void> {
  await graphqlClient.request(ACCEPT_DM_REQUEST_MUTATION, { id });
}

export async function ignoreDmRequest(id: string): Promise<void> {
  await graphqlClient.request(IGNORE_DM_REQUEST_MUTATION, { id });
}

export async function blockPrincipal(principalId: string): Promise<void> {
  await graphqlClient.request(BLOCK_PRINCIPAL_MUTATION, { principalId });
}

export async function unblockPrincipal(principalId: string): Promise<void> {
  await graphqlClient.request(UNBLOCK_PRINCIPAL_MUTATION, { principalId });
}

export type BlockedPrincipalView = Pick<
  BlockedPrincipal,
  "principalId" | "userId" | "username" | "displayName" | "blockedAt"
>;

/** The principals this account blocked, newest first. */
export async function fetchBlockedPrincipals(): Promise<BlockedPrincipalView[]> {
  const res = await graphqlClient.request<{ myBlockedPrincipals: BlockedPrincipalView[] }>(
    MY_BLOCKED_PRINCIPALS_QUERY,
  );
  return res.myBlockedPrincipals;
}

export async function reportDmRequest(id: string, reason: string): Promise<void> {
  await graphqlClient.request(REPORT_DM_REQUEST_MUTATION, { id, reason });
}

/** Items of the relay queue after `after`, oldest first. */
export async function fetchRelayItems(
  after: string | null,
  limit = 200,
): Promise<Pick<RelayItemPage, "hasMore"> & { items: RelayItemView[] }> {
  const res = await graphqlClient.request<{
    relayItems: { items: RelayItemView[]; hasMore: boolean };
  }>(RELAY_ITEMS_QUERY, { after, limit });
  return res.relayItems;
}

export async function ackRelayItems(upTo: string): Promise<void> {
  await graphqlClient.request(ACK_RELAY_ITEMS_MUTATION, { upTo });
}

/** The current `seq` of each stream of `serverId` the caller can see, from its host. */
export async function fetchStreamHeads(
  serverId: string,
  streams: string[],
): Promise<Map<string, number>> {
  const res = await graphqlClient.request<{ streamHeads: { stream: string; seq: string }[] }>(
    STREAM_HEADS_QUERY,
    { serverId, streams },
  );
  return new Map(res.streamHeads.map((h) => [h.stream, Number(h.seq)]));
}

export interface PredecessorView {
  id: string;
  memberIds: string[];
  predecessor: { hostServerId: string; conversationId: string } | null;
}

export async function fetchConversationPredecessor(
  serverId: string,
  conversationId: string,
): Promise<PredecessorView> {
  const res = await graphqlClient.request<{ conversation: PredecessorView }>(
    CONVERSATION_PREDECESSOR_QUERY,
    { serverId, conversationId },
  );
  return res.conversation;
}

/** A subscription of this relay to a workspace elsewhere, for this person. */
export type RemoteSubscriptionView = Pick<
  RemoteSubscription,
  "hostServerId" | "workspaceId" | "status" | "expiresAt" | "reason"
>;

/** How a device revocation reached one host. */
export interface RevocationFanoutView {
  hostServerId: string;
  status: RevocationFanoutStatus;
  ack: StatementOnly | null;
  attempts: number;
}

export async function fetchRemoteSubscriptions(): Promise<RemoteSubscriptionView[]> {
  const res = await graphqlClient.request<{ remoteSubscriptions: RemoteSubscriptionView[] }>(
    REMOTE_SUBSCRIPTIONS_QUERY,
  );
  return res.remoteSubscriptions;
}

export async function fetchDeviceRevocationStatus(
  deviceId: string,
): Promise<RevocationFanoutView[]> {
  const res = await graphqlClient.request<{ deviceRevocationStatus: RevocationFanoutView[] }>(
    DEVICE_REVOCATION_STATUS_QUERY,
    { deviceId },
  );
  return res.deviceRevocationStatus;
}

/** The tokens a join challenge names its workspace by: at most one of the two. */
export interface JoinChallengeTokens {
  inviteToken: string | null;
  publicLinkToken: string | null;
}

/**
 * A login challenge of `hostServerId`, fetched by the relay, for joining one of its spaces,
 * and the workspace an invite or a public link names there; for a public link also the
 * workspace's name and what the link does.
 */
export async function remoteJoinChallenge(
  hostServerId: string,
  hostOrigin: string,
  tokens: JoinChallengeTokens,
): Promise<
  Pick<
    RemoteJoinChallenge,
    "challengeId" | "nonce" | "expiresAt" | "workspaceId" | "workspaceName" | "publicLinkMode"
  >
> {
  const res = await graphqlClient.request<{ remoteJoinChallenge: RemoteJoinChallenge }>(
    REMOTE_JOIN_CHALLENGE_MUTATION,
    { hostServerId, hostOrigin, ...tokens },
  );
  return res.remoteJoinChallenge;
}

export async function joinRemoteWorkspace(
  input: JoinRemoteWorkspaceInput,
): Promise<RemoteJoinResult> {
  const res = await graphqlClient.request<{ joinRemoteWorkspace: RemoteJoinResult }>(
    JOIN_REMOTE_WORKSPACE_MUTATION,
    { input },
  );
  return res.joinRemoteWorkspace;
}

export async function renewDelegations(
  delegations: SignedStatementInput[],
): Promise<RemoteSubscriptionView[]> {
  const res = await graphqlClient.request<{ renewDelegations: RemoteSubscriptionView[] }>(
    RENEW_DELEGATIONS_MUTATION,
    { delegations },
  );
  return res.renewDelegations;
}

/** A workspace's name, from its host through the forward path. */
export async function fetchRemoteWorkspaceName(serverId: string): Promise<string> {
  const res = await graphqlClient.request<{ server: { id: string; name: string } }>(
    REMOTE_WORKSPACE_QUERY,
    { serverId },
  );
  return res.server.name;
}

/** A workspace owner's name as shown, from its host; null when it has none. */
export async function fetchRemoteWorkspaceOwner(serverId: string): Promise<string | null> {
  const res = await graphqlClient.request<{
    server: { id: string; owner: { username: string; displayName: string | null } | null };
  }>(REMOTE_WORKSPACE_OWNER_QUERY, { serverId });
  return ownerName(res.server.owner);
}
