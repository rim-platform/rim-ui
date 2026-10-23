/**
 * Joining a workspace hosted on another server through this app's relay:
 *
 * 1. pin the host from the invite: the origin must serve the invite's server id, and the key
 *    hash must name a key of its log followed only by `signer: server` rotations;
 * 2. ask the host for a login challenge through the relay (it also names the workspace the
 *    invite token or public link is for);
 * 3. sign a login proof whose audience is the host's server id, and a delegation for the relay;
 * 4. `joinRemoteWorkspace`; then bind the space to the host, keep the delegation, and take the
 *    host's stream heads as the baseline of its events (through the forward path).
 *
 * Through a public link that takes join requests, the host files a request instead of joining
 * the person: nothing is bound, kept or subscribed until the moderators accept it.
 */

import {
  JoinByPublicLinkOutcome,
  type PublicJoinLinkMode,
} from "../../../core/graphql/generated/schema-types";
import type { Statement } from "../../key-identity/browser/statements";
import { keyHash } from "../crypto/serverStatements";
import type { DelegationFields } from "../crypto/relayCrypto";
import type { JoinChallengeTokens } from "../api/relayApi";
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
    tokens: JoinChallengeTokens,
  ): Promise<{
    challengeId: string;
    nonce: string;
    workspaceId?: string | null;
    workspaceName?: string | null;
    publicLinkMode?: PublicJoinLinkMode | null;
  }>;
  signLogin(host: string, challenge: { challengeId: string; nonce: string }): Promise<Statement>;
  signDelegation(fields: DelegationFields): Promise<Statement>;
  join(input: {
    hostServerId: string;
    hostOrigin: string;
    inviteToken: string | null;
    publicLinkToken: string | null;
    message: string | null;
    proof: Statement;
    delegation: Statement;
  }): Promise<{
    hostServerId: string;
    workspaceId: string;
    userId: string;
    role: string;
    outcome: JoinByPublicLinkOutcome;
    joinRequestId?: string | null;
    joinRequestExpiresAt?: string | null;
  }>;
  /** Bind the workspace to its host; `false` when the id is taken. */
  registerSpace(workspaceId: string, host: string): Promise<boolean>;
  saveDelegation(record: DelegationRecord): Promise<void>;
  /** The host's heads of `streams`, through the forward path. */
  streamHeads(workspaceId: string, streams: string[]): Promise<Map<string, number>>;
  /** Store the heads as the last applied `seq` of each stream. */
  setBaseline(host: string, workspaceId: string, heads: Map<string, number>): Promise<void>;
  now(): number;
}

/** A workspace on `host` this account is a member of: to join again without a token. */
export interface MemberJoin {
  hostServerId: string;
  hostOrigin: string;
  workspaceId: string;
}

/** A workspace's public link at `hostOrigin`, with the note to its moderators. */
export interface PublicLinkJoin {
  hostServerId: string;
  hostOrigin: string;
  publicLinkToken: string;
  message?: string | null;
}

/** A workspace on another server this account joined. */
export interface JoinedWorkspace {
  outcome: JoinByPublicLinkOutcome.JOINED;
  hostServerId: string;
  workspaceId: string;
  role: string;
}

/** A join request filed at another server through a workspace's public link. */
export interface RequestedJoin {
  outcome: JoinByPublicLinkOutcome.REQUESTED;
  hostServerId: string;
  workspaceId: string;
  /** The workspace's name, as the link named it; null when the host did not say. */
  workspaceName: string | null;
  joinRequestId: string;
  /** When the request expires unless it is decided first, in milliseconds. */
  expiresAt: number;
}

/**
 * Join the workspace an invite or a public link is for, or rejoin `workspaceId` on `host` as a
 * current member (no token). Through a public link that takes join requests, the host files a
 * request and nothing is bound, kept or subscribed here.
 *
 * @returns The joined workspace, or the request filed.
 */
export async function joinRemote(
  invite: InviteLink | MemberJoin | PublicLinkJoin,
  deps: JoinDeps,
): Promise<JoinedWorkspace | RequestedJoin> {
  const host = invite.hostServerId;
  const origin = invite.hostOrigin;
  const inviteToken = "inviteToken" in invite ? invite.inviteToken : null;
  const publicLinkToken = "publicLinkToken" in invite ? invite.publicLinkToken : null;
  const message = "publicLinkToken" in invite ? (invite.message ?? null) : null;
  const pin = await deps.pinHost(origin, host);
  if ("hostKeyHash" in invite && !(await pinNamesKey(pin, invite.hostKeyHash))) {
    throw new InviteKeyError();
  }
  const challenge = await deps.challenge(host, origin, { inviteToken, publicLinkToken });
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
    publicLinkToken,
    message,
    proof,
    delegation,
  });
  if (joined.hostServerId !== host || joined.workspaceId !== workspaceId) {
    throw new Error("The relay answered for another workspace than the one joined.");
  }
  if (joined.outcome === JoinByPublicLinkOutcome.REQUESTED) {
    const expiresAt = Date.parse(joined.joinRequestExpiresAt ?? "");
    if (!joined.joinRequestId || Number.isNaN(expiresAt)) {
      throw new Error("The server filed a join request but did not say which.");
    }
    return {
      outcome: JoinByPublicLinkOutcome.REQUESTED,
      hostServerId: host,
      workspaceId,
      workspaceName: challenge.workspaceName ?? null,
      joinRequestId: joined.joinRequestId,
      expiresAt,
    };
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
  return {
    outcome: JoinByPublicLinkOutcome.JOINED,
    hostServerId: host,
    workspaceId,
    role: joined.role,
  };
}
