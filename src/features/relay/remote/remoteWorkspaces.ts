/**
 * Workspaces on other servers, wired to the app: joining one from an invite link, keeping
 * their delegations fresh while the app runs, and catching a space up after a lapse.
 */

import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import {
  fetchRemoteWorkspaceName,
  fetchStreamHeads,
  joinRemoteWorkspace,
  remoteJoinChallenge,
  renewDelegations,
} from "../api/relayApi";
import { relayCrypto } from "../crypto/relayCrypto";
import { activeProcessor as relayProcessor } from "../stream/activeProcessor";
import { allRecords, getRecord, putRecord, type DelegationRecord } from "../state/relayDb";
import { pinServer } from "../state/serverPins";
import { accountKey, registerSpace, remoteWorkspaces, setSpaceName } from "../state/spaces";
import { useRelayStore } from "../state/useRelayStore";
import { renewDue, type RenewOutcome } from "./delegations";
import { parseInviteLink } from "./inviteLink";
import { joinRemote, type JoinedWorkspace } from "./joinRemote";
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

/** Join the workspace a `rim-invite:` link is for, through this relay. */
export async function joinWithInvite(text: string): Promise<JoinedWorkspace> {
  const invite = parseInviteLink(text);
  const { account, key } = signedIn();
  const crypto = relayCrypto();
  const joined = await joinRemote(invite, {
    principalId: account.principalId,
    account: key,
    pinHost: (origin, serverId) => pinServer(origin, serverId),
    relay: () => relaySelf(),
    challenge: (host, origin, token) => remoteJoinChallenge(host, origin, token),
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
  });
  await refreshWorkspaceName(joined.workspaceId);
  return joined;
}

/** Ask a workspace's host for its name and remember it for the rail. */
export async function refreshWorkspaceName(workspaceId: string): Promise<void> {
  try {
    await setSpaceName(workspaceId, await fetchRemoteWorkspaceName(workspaceId));
  } catch (err) {
    logger.debug("[RIM:relay] a remote workspace's name is not known yet:", err);
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
