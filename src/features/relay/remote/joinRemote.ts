/**
 * Joining a workspace hosted on another server through this app's relay:
 *
 * 1. pin the host from the invite: the origin must serve the invite's server id, and the key
 *    hash must name a key of its log followed only by `signer: server` rotations;
 * 2. ask the host for a login challenge through the relay (it also names the workspace the
 *    invite token is for);
 * 3. sign a login proof whose audience is the host's server id, and a delegation for the relay;
 * 4. `joinRemoteWorkspace`; then bind the space to the host, keep the delegation, and take the
 *    host's stream heads as the baseline of its events (through the forward path).
 */

import type { Statement } from "../../key-identity/browser/statements";
import { keyHash } from "../crypto/serverStatements";
import type { DelegationFields } from "../crypto/relayCrypto";
import type { DelegationRecord, ServerPin } from "../state/relayDb";
import { delegationFields } from "./delegations";
import type { InviteLink } from "./inviteLink";
import type { RelaySelf } from "./relaySelf";

/** A key of the pinned log is named by `hash`, with no `signer: recovery` rotation after it. */
export async function pinNamesKey(pin: ServerPin, hash: string): Promise<boolean> {
  for (let seq = pin.keys.length - 1; seq >= 0; seq--) {
    if ((await keyHash(pin.keys[seq])) === hash) return true;
    if (pin.signers[seq] === "recovery") return false;
  }
  return false;
}

/** The invite names a key the host no longer uses, or another server. */
export class InviteKeyError extends Error {
  constructor() {
    super(
      "This invite names a key the server no longer uses. Ask for a new invite, and check it came from the workspace.",
    );
    this.name = "InviteKeyError";
  }
}

/** What joining needs from the rest of the app; injected so it can be tested alone. */
export interface JoinDeps {
  principalId: string;
  account: string;
  /** Pin the server at `origin`, refusing another id than `serverId`. */
  pinHost(origin: string, serverId: string): Promise<ServerPin>;
  relay(): Promise<RelaySelf>;
  challenge(
    host: string,
    origin: string,
    inviteToken: string | null,
  ): Promise<{ challengeId: string; nonce: string; workspaceId?: string | null }>;
  signLogin(host: string, challenge: { challengeId: string; nonce: string }): Promise<Statement>;
  signDelegation(fields: DelegationFields): Promise<Statement>;
  join(input: {
    hostServerId: string;
    hostOrigin: string;
    inviteToken: string | null;
    proof: Statement;
    delegation: Statement;
  }): Promise<{ hostServerId: string; workspaceId: string; userId: string; role: string }>;
  /** Bind the workspace to its host; `false` when the id is taken. */
  registerSpace(workspaceId: string, host: string): Promise<boolean>;
  saveDelegation(record: DelegationRecord): Promise<void>;
  /** The host's heads of `streams`, through the forward path. */
  streamHeads(workspaceId: string, streams: string[]): Promise<Map<string, number>>;
  /** Store the heads as the last applied `seq` of each stream. */
  setBaseline(host: string, workspaceId: string, heads: Map<string, number>): Promise<void>;
  now(): number;
}

export interface JoinedWorkspace {
  hostServerId: string;
  workspaceId: string;
  role: string;
}

/**
 * Join the workspace an invite is for, or rejoin `workspaceId` on `host` as a current member
 * (`inviteToken` null).
 */
export async function joinRemote(
  invite: InviteLink | { hostServerId: string; hostOrigin: string; workspaceId: string },
  deps: JoinDeps,
): Promise<JoinedWorkspace> {
  const host = invite.hostServerId;
  const origin = invite.hostOrigin;
  const inviteToken = "inviteToken" in invite ? invite.inviteToken : null;
  const pin = await deps.pinHost(origin, host);
  if ("hostKeyHash" in invite && !(await pinNamesKey(pin, invite.hostKeyHash))) {
    throw new InviteKeyError();
  }
  const challenge = await deps.challenge(host, origin, inviteToken);
  const workspaceId = "workspaceId" in invite ? invite.workspaceId : challenge.workspaceId;
  if (!workspaceId) throw new Error("The server did not say which workspace the invite is for.");
  const proof = await deps.signLogin(host, challenge);
  const now = deps.now();
  const fields = delegationFields(await deps.relay(), host, workspaceId, now);
  const delegation = await deps.signDelegation(fields);
  const joined = await deps.join({
    hostServerId: host,
    hostOrigin: origin,
    inviteToken,
    proof,
    delegation,
  });
  if (joined.hostServerId !== host || joined.workspaceId !== workspaceId) {
    throw new Error("The relay answered for another workspace than the one joined.");
  }
  if (!(await deps.registerSpace(workspaceId, host))) {
    throw new Error("This workspace's id is already used by another server; RIM cannot open it.");
  }
  await deps.saveDelegation({
    account: deps.account,
    workspaceId,
    host,
    relay: fields.relay,
    issuedAt: Date.parse(fields.issuedAt),
    expiresAt: Date.parse(fields.expiresAt),
    statement: delegation,
  });
  try {
    const heads = await deps.streamHeads(workspaceId, ["w", `u:${deps.principalId}`]);
    await deps.setBaseline(host, workspaceId, heads);
  } catch {
    // Without the heads, the first event seen on each stream is its baseline.
  }
  return { hostServerId: host, workspaceId, role: joined.role };
}
