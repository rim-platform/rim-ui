/**
 * Workspaces on other servers, wired to the app: joining one from an invite link or its public
 * link, keeping their delegations fresh while the app runs, and catching a space up after a
 * lapse.
 */

import {
  JoinByPublicLinkOutcome,
  type PublicJoinLinkMode,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import {
  fetchRemoteWorkspaceName,
  fetchRemoteWorkspaceOwner,
  fetchStreamHeads,
  joinRemoteWorkspace,
  remoteJoinChallenge,
  renewDelegations,
} from "../api/relayApi";
import { relayCrypto } from "../crypto/relayCrypto";
import { activeProcessor as relayProcessor } from "../stream/activeProcessor";
import { allRecords, getRecord, putRecord, type DelegationRecord } from "../state/relayDb";
import { pinServer } from "../state/serverPins";
import { accountKey, registerSpace, remoteWorkspaces, setSpaceDetails } from "../state/spaces";
import { useRelayStore } from "../state/useRelayStore";
import { inviteCodeToken } from "../../auth/inviteCode";
import { renewDue, type RenewOutcome } from "./delegations";
import { parseInviteLink } from "./inviteLink";
import {
  joinRemote,
  type JoinDeps,
  type JoinedWorkspace,
  type MemberJoin,
  type RequestedJoin,
} from "./joinRemote";
import { addPendingRemoteJoin } from "./pendingRemoteJoins";
import { relaySelf } from "./relaySelf";

function signedIn() {
  const account = useRelayStore.getState().account;
  const key = accountKey();
  if (!account || !key) throw new Error("Joining a workspace on another server needs key sign-in.");
  if (!account.deviceId) throw new Error("This device holds no key for this account.");
  return { account, key };
}

/** The delegations this device signed for this account's relay. */
export async function delegationRecords(): Promise<DelegationRecord[]> {
  const key = accountKey();
  if (!key) return [];
  return (await allRecords<DelegationRecord>("delegations")).filter((r) => r.account === key);
}

/** What joining a workspace on another server needs, for the signed-in account and this device. */
function joinDeps(): JoinDeps {
  const { account, key } = signedIn();
  const crypto = relayCrypto();
  return {
    principalId: account.principalId,
    account: key,
    pinHost: (origin, serverId) => pinServer(origin, serverId),
    relay: () => relaySelf(),
    challenge: (host, origin, tokens) => remoteJoinChallenge(host, origin, tokens),
    signLogin: (host, challenge) =>
      crypto.signLoginForServer(account.endpoint, host, account.principalId, challenge),
    signDelegation: (fields) =>
      crypto.signDelegation(account.endpoint, account.principalId, fields),
    join: (input) => joinRemoteWorkspace(input),
    registerSpace: (workspaceId, host) => registerSpace(workspaceId, host, "workspace"),
    saveDelegation: (record) => putRecord("delegations", record),
    streamHeads: fetchStreamHeads,
    setBaseline: async (host, workspaceId, heads) => {
      await relayProcessor()?.baseline(host, workspaceId, heads);
    },
    now: () => Date.now(),
  };
}

/** Join the workspace a `rim-invite:` link is for, through this relay. */
export async function joinWithInvite(text: string): Promise<JoinedWorkspace> {
  const joined = await joinRemote(parseInviteLink(text), joinDeps());
  if (joined.outcome !== JoinByPublicLinkOutcome.JOINED) {
    throw new Error("The server filed a join request for an invite.");
  }
  await refreshWorkspaceDetails(joined.workspaceId);
  return joined;
}

/** What a public link of another server names, before the person joins or asks to join. */
export interface RemotePublicLinkPreview {
  workspaceName: string | null;
  mode: PublicJoinLinkMode | null;
  hostServerId: string;
  hostOrigin: string;
}

/** The token and origin of a public link of another server; throws for anything else. */
function remotePublicLink(url: string): { token: string; hostOrigin: string } {
  const code = inviteCodeToken(url);
  if (code.kind !== "publicLink" || !code.hostOrigin) {
    throw new Error("This is not a public link of another server.");
  }
  return { token: code.token, hostOrigin: code.hostOrigin };
}

/**
 * Look up a public link of another server: pin the server at the link's origin, and ask it,
 * through this relay, which workspace the link is for and what it does. The link is checked,
 * not used.
 *
 * @param url - The link, `https://<other server>/join/rim_pjl_…`.
 */
export async function previewPublicLink(url: string): Promise<RemotePublicLinkPreview> {
  const { token, hostOrigin } = remotePublicLink(url);
  signedIn();
  const pin = await pinServer(hostOrigin);
  const challenge = await remoteJoinChallenge(pin.serverId, hostOrigin, {
    inviteToken: null,
    publicLinkToken: token,
  });
  return {
    workspaceName: challenge.workspaceName ?? null,
    mode: challenge.publicLinkMode ?? null,
    hostServerId: pin.serverId,
    hostOrigin,
  };
}

/**
 * Join a workspace of another server through its public link, or ask to join it. A request
 * filed is kept until its decision arrives; a join refreshes the workspace's details.
 *
 * @param url - The link, `https://<other server>/join/rim_pjl_…`.
 * @param message - The note to the moderators of a link that takes join requests.
 */
export async function joinWithPublicLink(
  url: string,
  message?: string,
): Promise<JoinedWorkspace | RequestedJoin> {
  const { token, hostOrigin } = remotePublicLink(url);
  const deps = joinDeps();
  const pin = await pinServer(hostOrigin);
  const result = await joinRemote(
    { hostServerId: pin.serverId, hostOrigin, publicLinkToken: token, message: message || null },
    deps,
  );
  if (result.outcome === JoinByPublicLinkOutcome.REQUESTED) {
    addPendingRemoteJoin({
      hostServerId: result.hostServerId,
      hostOrigin,
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      joinRequestId: result.joinRequestId,
      expiresAt: result.expiresAt,
    });
  } else {
    await refreshWorkspaceDetails(result.workspaceId);
  }
  return result;
}

/**
 * Finish joining a workspace of another server whose moderators accepted the request: join as
 * the current member the host made this account, with a fresh challenge and delegation.
 */
export async function joinAsMember(entry: MemberJoin): Promise<JoinedWorkspace> {
  const joined = await joinRemote(
    {
      hostServerId: entry.hostServerId,
      hostOrigin: entry.hostOrigin,
      workspaceId: entry.workspaceId,
    },
    joinDeps(),
  );
  if (joined.outcome !== JoinByPublicLinkOutcome.JOINED) {
    throw new Error("The server filed a join request for a member.");
  }
  return joined;
}

/** Ask a workspace's host for its name and its owner, separately, and keep them for the rail. */
export async function refreshWorkspaceDetails(workspaceId: string): Promise<void> {
  try {
    await setSpaceDetails(workspaceId, { name: await fetchRemoteWorkspaceName(workspaceId) });
  } catch (err) {
    logger.debug("[RIM:relay] a remote workspace's name is not known yet:", err);
  }
  try {
    await setSpaceDetails(workspaceId, {
      ownerName: await fetchRemoteWorkspaceOwner(workspaceId),
    });
  } catch (err) {
    logger.debug("[RIM:relay] a remote workspace's owner is not known yet:", err);
  }
}

/**
 * Renew the delegations of this account's workspaces elsewhere that need it (all with
 * `force`), then catch up the spaces whose delegation had lapsed.
 */
export async function renewWorkspaceDelegations(force = false): Promise<RenewOutcome> {
  const { account, key } = signedIn();
  const workspaces = remoteWorkspaces();
  if (workspaces.length === 0) return { renewed: [], lapsed: [] };
  const crypto = relayCrypto();
  const outcome = await renewDue(
    workspaces,
    {
      account: key,
      relay: () => relaySelf(),
      load: (workspaceId) => getRecord<DelegationRecord>("delegations", [key, workspaceId]),
      save: (record) => putRecord("delegations", record),
      sign: (fields) => crypto.signDelegation(account.endpoint, account.principalId, fields),
      renew: (delegations) => renewDelegations(delegations),
      now: () => Date.now(),
    },
    force,
  );
  useRelayStore.getState().noteRenewals(outcome.renewed);
  for (const workspaceId of outcome.lapsed) await catchUp(workspaceId);
  if (outcome.renewed.length > 0) {
    void queryClient.invalidateQueries({ queryKey: ["remoteSubscriptions"] });
  }
  return outcome;
}

/** Catch a space up after its events stopped: its lists and feed, then its stream heads. */
export async function catchUp(workspaceId: string): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: queryKeys.server(workspaceId) });
  await relayProcessor()?.reconcileSpace(workspaceId);
}
