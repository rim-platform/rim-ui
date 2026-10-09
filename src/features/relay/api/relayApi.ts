/**
 * The relay's server calls. Calls about a space on another server (`streamHeads`, a
 * conversation's predecessor) carry its id in `serverId`, so the GraphQL client sends them to
 * its host through the relay.
 */

import { graphqlClient } from "../../../core/graphql/client";
import type {
  Contact,
  DmRequestStatus,
  RelayItemPage,
  SignedStatement,
} from "../../../core/graphql/generated/schema-types";
import type { RelayInfo } from "../state/useRelayStore";
import {
  ACCEPT_DM_REQUEST_MUTATION,
  ACK_RELAY_ITEMS_MUTATION,
  ADD_CONTACT_MUTATION,
  BLOCK_PRINCIPAL_MUTATION,
  CONTACTS_QUERY,
  CONVERSATION_PREDECESSOR_QUERY,
  DM_REQUESTS_QUERY,
  IGNORE_DM_REQUEST_MUTATION,
  RELAY_INFO_QUERY,
  RELAY_ITEMS_QUERY,
  RELAY_ME_QUERY,
  REMOTE_IDENTITY_QUERY,
  REMOTE_SERVER_QUERY,
  REMOVE_CONTACT_MUTATION,
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
