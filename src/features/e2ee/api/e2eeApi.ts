/**
 * The server calls of end-to-end encryption. The webview makes them (it holds the session
 * cookie); what they return is handed to the Tauri side, which holds the group state.
 */

import { graphqlClient } from "../../../core/graphql/client";
import type {
  ClaimedKeyPackage,
  ConversationTypeEnum,
  MlsCommit,
  MlsDevice,
  MlsGroup,
  MlsKeyPackageStatus,
  MlsPendingDevice,
  MlsReaddRequest,
  MlsWelcome,
  PrincipalDevice,
  SendEncryptedMessageInput,
  SignedStatementInput,
  SubmitMlsCommitInput,
} from "../../../core/graphql/generated/schema-types";
import type { MessageItem } from "../../../core/types/messages";
import { remoteHosts } from "../../relay/state/spaces";
import { hostClient } from "../../relay/transport/remoteFetch";
import {
  ACK_WELCOMES_MUTATION,
  CLAIM_KEY_PACKAGES_MUTATION,
  CONVERSATION_GROUP_QUERY,
  EDIT_ENCRYPTED_MESSAGE_MUTATION,
  MESSAGE_ATTACHMENTS_QUERY,
  MLS_COMMITS_QUERY,
  MY_KEY_PACKAGE_STATUS_QUERY,
  MY_WELCOMES_QUERY,
  PRINCIPAL_DEVICES_QUERY,
  REQUEST_READD_MUTATION,
  SEND_ENCRYPTED_MESSAGE_MUTATION,
  SUBMIT_COMMIT_MUTATION,
  THREAD_ROOT_QUERY,
  UPLOAD_KEY_PACKAGES_MUTATION,
} from "./documents";

/** The suite every group uses: X25519 + ML-KEM-768, AES-128-GCM, SHA-256, Ed25519. */
export const CIPHER_SUITE = 0x004f;

export type ServerGroup = Pick<MlsGroup, "groupId" | "incarnation" | "cipherSuite" | "epoch"> & {
  devices: MlsDevice[];
  pendingAdds: MlsPendingDevice[];
  pendingRemoves: MlsDevice[];
  readdRequests: (Pick<MlsReaddRequest, "principalId" | "deviceId" | "createdAt"> & {
    request: SignedStatementInput;
  })[];
};

/** A conversation as the encryption code needs it. */
export interface ConversationGroupInfo {
  id: string;
  conversationType: ConversationTypeEnum;
  memberIds: string[];
  createdBy: string | null;
  encryptedAt: string | null;
  mlsGroup: ServerGroup | null;
}

export type ServerCommit = Pick<
  MlsCommit,
  "id" | "incarnation" | "epoch" | "senderPrincipalId" | "senderDeviceId" | "message"
>;
export type ServerWelcome = Pick<
  MlsWelcome,
  "id" | "serverId" | "conversationId" | "incarnation" | "epoch" | "message"
>;
export type ClaimedPackage = Pick<
  ClaimedKeyPackage,
  "userId" | "principalId" | "deviceId" | "keyPackage" | "keyPackageRef" | "lastResort"
>;
export type KeyPackageStatus = Pick<
  MlsKeyPackageStatus,
  "cipherSuite" | "available" | "lastResortNotAfter" | "lastResortClaims"
>;
export type DirectoryDevice = Pick<
  PrincipalDevice,
  "deviceId" | "name" | "revokedAt" | "mlsActive"
> & { certificate: SignedStatementInput; revocation: SignedStatementInput | null };
export interface DirectoryPrincipal {
  principalId: string;
  devices: DirectoryDevice[];
}

export async function fetchConversationGroup(
  serverId: string,
  conversationId: string,
): Promise<ConversationGroupInfo> {
  const res = await graphqlClient.request<{ conversation: ConversationGroupInfo }>(
    CONVERSATION_GROUP_QUERY,
    { serverId, conversationId },
  );
  return res.conversation;
}

export async function fetchKeyPackageStatus(): Promise<KeyPackageStatus | null> {
  const res = await graphqlClient.request<{ myMlsKeyPackageStatus: KeyPackageStatus[] }>(
    MY_KEY_PACKAGE_STATUS_QUERY,
  );
  return res.myMlsKeyPackageStatus.find((s) => s.cipherSuite === CIPHER_SUITE) ?? null;
}

export async function uploadKeyPackages(keyPackages: string[]): Promise<void> {
  // The server takes at most 50 per upload.
  for (let i = 0; i < keyPackages.length; i += 50) {
    await graphqlClient.request(UPLOAD_KEY_PACKAGES_MUTATION, {
      keyPackages: keyPackages.slice(i, i + 50),
    });
  }
}

export async function claimKeyPackages(
  serverId: string,
  conversationId: string,
  devices: { principalId: string; deviceId: string }[],
): Promise<ClaimedPackage[]> {
  if (devices.length === 0) return [];
  const res = await graphqlClient.request<{ claimMlsKeyPackages: ClaimedPackage[] }>(
    CLAIM_KEY_PACKAGES_MUTATION,
    { input: { serverId, conversationId, devices } },
  );
  return res.claimMlsKeyPackages;
}

export async function submitCommit(input: SubmitMlsCommitInput): Promise<void> {
  await graphqlClient.request(SUBMIT_COMMIT_MUTATION, { input });
}

/** Every Commit of `incarnation` from `fromEpoch` on, oldest first. */
export async function fetchCommits(
  serverId: string,
  conversationId: string,
  incarnation: number,
  fromEpoch: number,
): Promise<ServerCommit[]> {
  const commits: ServerCommit[] = [];
  let afterEpoch: number | null = fromEpoch > 0 ? fromEpoch - 1 : null;
  for (;;) {
    const res = await graphqlClient.request<{
      mlsCommits: { commits: ServerCommit[]; hasMore: boolean };
    }>(MLS_COMMITS_QUERY, { serverId, conversationId, incarnation, afterEpoch, limit: 100 });
    commits.push(...res.mlsCommits.commits);
    const last = res.mlsCommits.commits[res.mlsCommits.commits.length - 1];
    if (!res.mlsCommits.hasMore || !last) return commits;
    afterEpoch = last.epoch;
  }
}

/** The server each fetched Welcome came from: `null` for this relay, else the host's id. */
const welcomeHosts = new Map<string, string | null>();

/**
 * Welcomes waiting for this device: on this relay, and on each host of a space on another
 * server this account uses (a DM homed on another relay). A host that does not answer is
 * asked again next time.
 */
export async function fetchWelcomes(): Promise<ServerWelcome[]> {
  const res = await graphqlClient.request<{ myMlsWelcomes: ServerWelcome[] }>(MY_WELCOMES_QUERY);
  const remote = await Promise.all(
    remoteHosts().map(async (host) => {
      try {
        const answer = await hostClient(host).request<{ myMlsWelcomes: ServerWelcome[] }>(
          MY_WELCOMES_QUERY,
        );
        return answer.myMlsWelcomes.map((welcome) => ({ welcome, host }));
      } catch {
        return [];
      }
    }),
  );
  const all = [...res.myMlsWelcomes.map((welcome) => ({ welcome, host: null })), ...remote.flat()];
  for (const { welcome, host } of all) welcomeHosts.set(welcome.id, host);
  return all.map(({ welcome }) => welcome);
}

/** Acknowledge Welcomes, each on the server it came from. */
export async function ackWelcomes(ids: string[]): Promise<void> {
  const byHost = new Map<string | null, string[]>();
  for (const id of ids) {
    const host = welcomeHosts.get(id) ?? null;
    byHost.set(host, [...(byHost.get(host) ?? []), id]);
    welcomeHosts.delete(id);
  }
  for (const [host, hostIds] of byHost) {
    const client = host ? hostClient(host) : graphqlClient;
    await client.request(ACK_WELCOMES_MUTATION, { ids: hostIds });
  }
}

/** Device lists of principals, at most 100 per call. */
export async function fetchPrincipalDevices(principalIds: string[]): Promise<DirectoryPrincipal[]> {
  const out: DirectoryPrincipal[] = [];
  for (let i = 0; i < principalIds.length; i += 100) {
    const res = await graphqlClient.request<{ principalDevices: DirectoryPrincipal[] }>(
      PRINCIPAL_DEVICES_QUERY,
      { principalIds: principalIds.slice(i, i + 100) },
    );
    out.push(...res.principalDevices);
  }
  return out;
}

export async function sendEncryptedMessage(input: SendEncryptedMessageInput): Promise<MessageItem> {
  const res = await graphqlClient.request<{ sendEncryptedMessage: MessageItem }>(
    SEND_ENCRYPTED_MESSAGE_MUTATION,
    { input },
  );
  return res.sendEncryptedMessage;
}

export async function editEncryptedMessage(input: {
  serverId: string;
  conversationId: string;
  messageId: string;
  envelope: string;
}): Promise<MessageItem> {
  const res = await graphqlClient.request<{ editEncryptedMessage: MessageItem }>(
    EDIT_ENCRYPTED_MESSAGE_MUTATION,
    { input },
  );
  return res.editEncryptedMessage;
}

export async function requestReadd(
  serverId: string,
  conversationId: string,
  request: SignedStatementInput,
): Promise<void> {
  await graphqlClient.request(REQUEST_READD_MUTATION, {
    input: { serverId, conversationId, request },
  });
}

export async function fetchThreadRoot(
  serverId: string,
  conversationId: string,
  threadId: string,
): Promise<string | null> {
  const res = await graphqlClient.request<{ thread: { rootMessageId: string | null } }>(
    THREAD_ROOT_QUERY,
    { serverId, conversationId, threadId },
  );
  return res.thread.rootMessageId;
}

export interface UploadedAttachment {
  id: string;
  status: string;
  sizeBytes: number;
  blobSha256: string | null;
}

export async function fetchMessageAttachments(
  serverId: string,
  conversationId: string,
  messageId: string,
): Promise<UploadedAttachment[]> {
  const res = await graphqlClient.request<{ message: { attachments: UploadedAttachment[] } }>(
    MESSAGE_ATTACHMENTS_QUERY,
    { serverId, conversationId, messageId },
  );
  return res.message.attachments;
}
