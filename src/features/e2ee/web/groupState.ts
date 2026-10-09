/**
 * A conversation's group in this browser: what the store keeps about it, and the operations the
 * runtime drives with the server's data (create, commit, settle, join, process Commits, re-add
 * requests, forget). Each runs inside the caller's unit of work; a Commit is stored as pending
 * before the caller submits it.
 *
 * A conversation this browser keeps state for, or saw encrypted, is pinned as encrypted (`pins`)
 * for good, and a direct message keeps the two principals it was pinned to.
 */

import type {
  DeviceRefView,
  GroupView,
  MembershipEvent,
  OutgoingCommit,
  Reset,
} from "../api/e2eeCommands";
import { mlsCode, type MlsEngine } from "./mlsModule";
import type { Work } from "./store";

/** What the store keeps about a conversation's group (`groups`). */
export interface GroupState {
  /** The incarnation of the group state this browser holds; 0 for none. */
  incarnation: number;
  /** An incarnation this browser created and whose first Commit waits for the server. */
  nextIncarnation: number | null;
  /** The first epoch of `incarnation` this browser can decrypt. */
  joinEpoch: number;
  /** This browser processed its own removal. */
  removed: boolean;
  /** New leaves wait for verification. */
  verifyPending: boolean;
  unverified: GroupView["unverified"];
  /** The device whose Commit summary did not match its proposals. */
  misbehaved: DeviceRefView | null;
  /** Unix milliseconds of this browser's re-add request while it waits for it. */
  readdRequestedAt: number | null;
  /** Unix milliseconds of this browser's last Commit with an update path. */
  lastUpdateAt: number | null;
  /** The devices that started each incarnation after the first, as far as this browser saw. */
  resets: Reset[];
  /** The principals processed Commits added and removed, oldest first. */
  membership: MembershipEvent[];
}

/** How many membership events a conversation keeps. */
const MEMBERSHIP_EVENTS_KEPT = 200;

interface GroupRecord extends GroupState {
  endpoint: string;
  principalId: string;
  workspaceId: string;
  conversationId: string;
  /** When this browser last acted on a device's re-add request, Unix milliseconds by device. */
  readdHonored: Record<string, number>;
}

export function emptyState(): GroupState {
  return {
    incarnation: 0,
    nextIncarnation: null,
    joinEpoch: 0,
    removed: false,
    verifyPending: false,
    unverified: [],
    misbehaved: null,
    readdRequestedAt: null,
    lastUpdateAt: null,
    resets: [],
    membership: [],
  };
}

function groupKey(work: Work, workspaceId: string, conversationId: string): IDBValidKey {
  return [work.account.endpoint, work.account.principalId, workspaceId, conversationId];
}

async function loadRecord(
  work: Work,
  workspaceId: string,
  conversationId: string,
): Promise<GroupRecord | undefined> {
  return work.get<GroupRecord>("groups", groupKey(work, workspaceId, conversationId));
}

export async function loadState(
  work: Work,
  workspaceId: string,
  conversationId: string,
): Promise<GroupState> {
  const record = await loadRecord(work, workspaceId, conversationId);
  if (!record) return emptyState();
  return {
    incarnation: record.incarnation,
    nextIncarnation: record.nextIncarnation,
    joinEpoch: record.joinEpoch,
    removed: record.removed,
    verifyPending: record.verifyPending,
    unverified: record.unverified,
    misbehaved: record.misbehaved,
    readdRequestedAt: record.readdRequestedAt,
    lastUpdateAt: record.lastUpdateAt,
    resets: record.resets,
    membership: record.membership ?? [],
  };
}

/** What this browser pinned about a conversation (`pins`). */
export interface PinRecord {
  endpoint: string;
  principalId: string;
  workspaceId: string;
  conversationId: string;
  /** The server's `encryptedAt` as first seen, when it was. */
  encryptedAt: string | null;
  /** A direct message's two principals, sorted. */
  dmPrincipals: string[] | null;
}

export function loadPin(
  work: Work,
  workspaceId: string,
  conversationId: string,
): Promise<PinRecord | undefined> {
  return work.get<PinRecord>("pins", groupKey(work, workspaceId, conversationId));
}

/**
 * Pin the conversation as encrypted. The first `encryptedAt` and the first pair of
 * `dmPrincipals` handed in stay; later values change nothing.
 */
export async function pin(
  work: Work,
  workspaceId: string,
  conversationId: string,
  encryptedAt: string | null = null,
  dmPrincipals: string[] | null = null,
): Promise<void> {
  const dm = dmPrincipals ? [...new Set(dmPrincipals)].sort() : null;
  if (dm && dm.length !== 2) {
    throw invalid("a direct message is pinned to exactly two principals");
  }
  const current = await loadPin(work, workspaceId, conversationId);
  const next: PinRecord = {
    endpoint: work.account.endpoint,
    principalId: work.account.principalId,
    workspaceId,
    conversationId,
    encryptedAt: current?.encryptedAt ?? encryptedAt,
    dmPrincipals: current?.dmPrincipals ?? dm,
  };
  if (
    current?.encryptedAt === next.encryptedAt &&
    current.dmPrincipals?.join() === next.dmPrincipals?.join()
  ) {
    return;
  }
  work.put("pins", next);
}

/**
 * Whether `state` is a group's: held, being created, or waited for. The feed saves an empty state
 * for every conversation it follows, plaintext ones a plugin reads included.
 */
function holdsGroup(state: GroupState): boolean {
  return state.incarnation > 0 || state.nextIncarnation !== null || state.readdRequestedAt !== null;
}

/** Save the conversation's state; a conversation whose group this browser holds is pinned. */
export async function saveState(
  work: Work,
  workspaceId: string,
  conversationId: string,
  state: GroupState,
): Promise<void> {
  if (holdsGroup(state)) await pin(work, workspaceId, conversationId);
  const record = await loadRecord(work, workspaceId, conversationId);
  work.put("groups", {
    endpoint: work.account.endpoint,
    principalId: work.account.principalId,
    workspaceId,
    conversationId,
    readdHonored: record?.readdHonored ?? {},
    ...state,
  } satisfies GroupRecord);
}

/** The conversations of the workspace this browser keeps group state about or pinned. */
export async function conversations(work: Work, workspaceId: string): Promise<string[]> {
  const inWorkspace = (r: { workspaceId: string }) => r.workspaceId === workspaceId;
  const records = await work.all<GroupRecord>("groups", inWorkspace);
  const pins = await work.all<PinRecord>("pins", inWorkspace);
  const ids = [...records, ...pins].filter(inWorkspace).map((r) => r.conversationId);
  return [...new Set(ids)].sort();
}

/** Every conversation of the account with group state, in any workspace. */
export async function allGroups(
  work: Work,
): Promise<{ workspaceId: string; conversationId: string; state: GroupState }[]> {
  const records = await work.all<GroupRecord>("groups");
  return records.map((r) => ({
    workspaceId: r.workspaceId,
    conversationId: r.conversationId,
    state: r,
  }));
}

interface Status {
  epoch: number;
  commitPending: boolean;
  awaitingReadd: number | null;
}

/** The engine's status of a group, or `null` when this browser holds no state for it. */
export function groupStatus(
  engine: MlsEngine,
  conversationId: string,
  incarnation: number,
): Status | null {
  try {
    return JSON.parse(engine.groupStatus(conversationId, incarnation)) as Status;
  } catch (err) {
    if (mlsCode(err) === "E2EE_NO_GROUP") return null;
    throw err;
  }
}

/** Where a conversation's group stands in this browser, for the runtime and the UI. */
export async function view(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
): Promise<GroupView> {
  const state = await loadState(work, workspaceId, conversationId);
  const pinned = await loadPin(work, workspaceId, conversationId);
  const held = await loadRecord(work, workspaceId, conversationId);
  const out: GroupView = {
    conversationId,
    ...state,
    hasGroup: false,
    epoch: null,
    commitPending: false,
    awaitingReadd: null,
    pinned: Boolean(pinned) || Boolean(held && holdsGroup(held)),
    pinnedEncryptedAt: pinned?.encryptedAt ?? null,
    dmPrincipals: pinned?.dmPrincipals ?? null,
  };
  if (state.incarnation > 0) {
    const status = groupStatus(engine, conversationId, state.incarnation);
    if (status) {
      out.hasGroup = true;
      out.epoch = status.epoch;
      out.commitPending = status.commitPending;
      out.awaitingReadd = status.awaitingReadd;
    }
  }
  if (state.nextIncarnation !== null) {
    const status = groupStatus(engine, conversationId, state.nextIncarnation);
    if (status) out.commitPending ||= status.commitPending;
  }
  return out;
}

/** A key package `claimMlsKeyPackages` handed out, as the engine takes it. */
export interface ClaimedInput extends DeviceRefView {
  keyPackage: string;
}

export class GroupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GroupError";
    this.code = code;
  }
}

function invalid(message: string): GroupError {
  return new GroupError("INVALID_ARGS", message);
}

/**
 * Create `incarnation` of the conversation's group and stage its first Commit with the claimed
 * devices. The group this browser holds now stays usable until the server accepts it.
 */
export async function create(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  incarnation: number,
  claimed: ClaimedInput[],
): Promise<OutgoingCommit> {
  if (incarnation < 1) throw invalid("incarnations start at 1");
  const state = await loadState(work, workspaceId, conversationId);
  if (state.incarnation >= incarnation) {
    throw invalid("this device already holds that incarnation or a newer one");
  }
  // A creation that lost its race and was never settled leaves a group behind.
  if (state.nextIncarnation !== null) engine.deleteGroup(conversationId, state.nextIncarnation);
  const commit = JSON.parse(
    engine.createGroup(conversationId, incarnation, JSON.stringify(claimed)),
  ) as OutgoingCommit;
  state.nextIncarnation = incarnation;
  await saveState(work, workspaceId, conversationId, state);
  return commit;
}

/** Stage one Commit of every pending change in the current group (empty: a self-update). */
export async function commit(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  claimed: ClaimedInput[],
  removes: DeviceRefView[],
): Promise<OutgoingCommit> {
  const state = await loadState(work, workspaceId, conversationId);
  if (state.incarnation === 0 || state.removed) {
    throw new GroupError("E2EE_NO_GROUP", "no group for this conversation and incarnation");
  }
  return JSON.parse(
    engine.stageCommit(
      conversationId,
      state.incarnation,
      JSON.stringify(claimed),
      JSON.stringify(removes.map(({ principalId, deviceId }) => ({ principalId, deviceId }))),
    ),
  ) as OutgoingCommit;
}

function noteReset(state: GroupState, incarnation: number, by: DeviceRefView) {
  if (!state.resets.some((r) => r.incarnation === incarnation)) {
    state.resets.push({ incarnation, principalId: by.principalId, deviceId: by.deviceId });
  }
}

/** The principals a Commit brought into the group or took out of it. */
interface MembershipChange {
  added: string[];
  removed: string[];
}

/** Note what a Commit of `incarnation` that moved the group to `epoch` changed. */
function noteMembership(
  state: GroupState,
  incarnation: number,
  epoch: number,
  change: MembershipChange,
) {
  for (const principalId of change.added) {
    state.membership.push({ incarnation, epoch, kind: "added", principalId });
  }
  for (const principalId of change.removed) {
    state.membership.push({ incarnation, epoch, kind: "removed", principalId });
  }
  state.membership.splice(0, Math.max(0, state.membership.length - MEMBERSHIP_EVENTS_KEPT));
}

/** Make `incarnation`, whose first Commit this browser made, the current one. */
function promote(
  engine: MlsEngine,
  state: GroupState,
  conversationId: string,
  incarnation: number,
  me: DeviceRefView | null,
) {
  if (state.incarnation > 0 && state.incarnation !== incarnation) {
    engine.deleteGroup(conversationId, state.incarnation);
  }
  if (incarnation > 1 && me) noteReset(state, incarnation, me);
  state.incarnation = incarnation;
  state.nextIncarnation = null;
  // The first Commit moves the group from epoch 0 to 1, where messages start.
  state.joinEpoch = 1;
  state.removed = false;
  state.readdRequestedAt = null;
  state.verifyPending = true;
  state.lastUpdateAt = Date.now();
}

/**
 * The server answered this browser's pending Commit: merged when `accepted`, dropped when not.
 * The first Commit of a new incarnation makes that incarnation current.
 */
export async function settle(
  work: Work,
  engine: MlsEngine,
  me: DeviceRefView | null,
  workspaceId: string,
  conversationId: string,
  accepted: boolean,
): Promise<void> {
  const state = await loadState(work, workspaceId, conversationId);
  if (state.nextIncarnation !== null) {
    const next = state.nextIncarnation;
    if (groupStatus(engine, conversationId, next)?.commitPending) {
      if (accepted) {
        // The first Commit of an incarnation: its adds are the group, not changes to it.
        engine.commitAccepted(conversationId, next);
        promote(engine, state, conversationId, next, me);
      } else {
        engine.commitRejected(conversationId, next);
        state.nextIncarnation = null;
      }
      await saveState(work, workspaceId, conversationId, state);
      return;
    }
    state.nextIncarnation = null;
  }
  if (state.incarnation === 0) {
    throw new GroupError("E2EE_NO_PENDING_COMMIT", "no commit of this device is pending");
  }
  if (accepted) {
    const merged = JSON.parse(engine.commitAccepted(conversationId, state.incarnation)) as {
      epoch: number;
      membership: MembershipChange;
    };
    noteMembership(state, state.incarnation, merged.epoch, merged.membership);
    state.verifyPending = true;
    state.lastUpdateAt = Date.now();
  } else {
    engine.commitRejected(conversationId, state.incarnation);
  }
  await saveState(work, workspaceId, conversationId, state);
}

interface Joined {
  epoch: number;
  welcomer: DeviceRefView | null;
}

/**
 * Join `incarnation` of the conversation's group from a Welcome. An older incarnation's state
 * goes; every leaf waits for verification. A Welcome to an epoch the held state of the same
 * incarnation already reached is refused (`E2EE_STALE_WELCOME`) unless the group waits for a
 * re-add.
 */
export async function join(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  incarnation: number,
  welcome: string,
): Promise<void> {
  const state = await loadState(work, workspaceId, conversationId);
  if (incarnation < state.incarnation) {
    throw invalid("the Welcome is for an older incarnation than this device holds");
  }
  const joined = JSON.parse(engine.join(conversationId, incarnation, welcome)) as Joined;
  if (state.incarnation > 0 && state.incarnation !== incarnation) {
    engine.deleteGroup(conversationId, state.incarnation);
    if (joined.welcomer) noteReset(state, incarnation, joined.welcomer);
  }
  if (state.nextIncarnation !== null) {
    if (state.nextIncarnation !== incarnation) {
      engine.deleteGroup(conversationId, state.nextIncarnation);
    }
    state.nextIncarnation = null;
  }
  state.incarnation = incarnation;
  state.joinEpoch = joined.epoch;
  state.removed = false;
  state.readdRequestedAt = null;
  state.verifyPending = true;
  // The weekly self-update counts from the join.
  state.lastUpdateAt ??= Date.now();
  await saveState(work, workspaceId, conversationId, state);
}

/** A Commit as `mlsCommits` returns it. */
export interface CommitInput {
  incarnation: number;
  epoch: number;
  message: string;
}

/** What applying one Commit did. */
export type CommitStep = "applied" | "skipped" | "gap" | "cannotProcess";

type Outcome =
  | {
      kind: "applied";
      epoch: number;
      committer: DeviceRefView | null;
      membership: MembershipChange;
      toVerify: number;
      selfRemoved: boolean;
    }
  | { kind: "ownMerged"; epoch: number; membership: MembershipChange }
  | { kind: "cannotProcess"; reason: string; committer: DeviceRefView | null };

/** Apply a fetched Commit to the group it names, if this browser holds it at that epoch. */
export function applyCommit(
  engine: MlsEngine,
  state: GroupState,
  conversationId: string,
  commit: CommitInput,
): CommitStep {
  const creating = state.nextIncarnation === commit.incarnation;
  if ((commit.incarnation !== state.incarnation || state.removed) && !creating) return "skipped";
  const status = groupStatus(engine, conversationId, commit.incarnation);
  if (!status) return "skipped";
  if (status.awaitingReadd !== null) return "cannotProcess";
  if (commit.epoch < status.epoch) return "skipped";
  if (commit.epoch > status.epoch) return "gap";
  let outcome: Outcome;
  try {
    outcome = JSON.parse(
      engine.processCommit(conversationId, commit.incarnation, commit.message),
    ) as Outcome;
  } catch (err) {
    const code = mlsCode(err);
    if (code === "E2EE_EPOCH_MISMATCH") return "skipped";
    if (code === "E2EE_MALFORMED" || code === "E2EE_WRONG_GROUP" || code === "E2EE_MLS") {
      if (creating) {
        engine.deleteGroup(conversationId, commit.incarnation);
        state.nextIncarnation = null;
        return "skipped";
      }
      return "cannotProcess";
    }
    throw err;
  }
  if (outcome.kind === "ownMerged") {
    if (creating) {
      promote(engine, state, conversationId, commit.incarnation, null);
    } else {
      noteMembership(state, commit.incarnation, outcome.epoch, outcome.membership);
      state.verifyPending = true;
      state.lastUpdateAt = Date.now();
    }
    return "applied";
  }
  if (creating) {
    // Another device created this incarnation first: this browser's attempt is void, and it
    // joins through the Welcome the winner made for it.
    engine.deleteGroup(conversationId, commit.incarnation);
    state.nextIncarnation = null;
    return "skipped";
  }
  if (outcome.kind === "cannotProcess") {
    // A Commit that broke a rule (proposals other than Add and Remove, or a summary that does
    // not name them) was not merged: its committer misbehaved.
    if (outcome.committer) state.misbehaved = outcome.committer;
    return "cannotProcess";
  }
  if (outcome.selfRemoved) state.removed = true;
  else noteMembership(state, commit.incarnation, outcome.epoch, outcome.membership);
  if (outcome.toVerify > 0) state.verifyPending = true;
  return "applied";
}

/**
 * Apply fetched Commits in order, outside a feed sync. Stops at a gap or a Commit it cannot
 * process.
 */
export async function processCommits(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  commits: CommitInput[],
): Promise<CommitStep> {
  const state = await loadState(work, workspaceId, conversationId);
  let last: CommitStep = "skipped";
  const ordered = [...commits].sort((a, b) => a.incarnation - b.incarnation || a.epoch - b.epoch);
  for (const commit of ordered) {
    const step = applyCommit(engine, state, conversationId, commit);
    if (step === "applied") last = "applied";
    else if (step === "gap" || step === "cannotProcess") {
      last = step;
      break;
    }
  }
  await saveState(work, workspaceId, conversationId, state);
  return last;
}

/**
 * The payload of a re-add request for the device key to sign. This browser's state of
 * `incarnation` goes (a re-add starts from a fresh Welcome).
 */
export async function prepareReadd(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  incarnation: number,
): Promise<string> {
  const state = await loadState(work, workspaceId, conversationId);
  const payload = engine.prepareReadd(conversationId, incarnation);
  if (state.incarnation === incarnation) state.incarnation = 0;
  state.readdRequestedAt = Date.now();
  await saveState(work, workspaceId, conversationId, state);
  return payload;
}

/** Forget the conversation's group state and what the store keeps about it, but its pin. */
export async function forget(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const record = await loadRecord(work, workspaceId, conversationId);
  if (record && holdsGroup(record)) await pin(work, workspaceId, conversationId);
  const state = await loadState(work, workspaceId, conversationId);
  for (const incarnation of [state.incarnation, state.nextIncarnation]) {
    if (incarnation) engine.deleteGroup(conversationId, incarnation);
  }
  work.delete("groups", groupKey(work, workspaceId, conversationId));
  const outgoing = await work.all<{ messageId: string; conversationId: string }>(
    "outgoing",
    (r) => r.conversationId === conversationId,
  );
  for (const record of outgoing) {
    if (record.conversationId !== conversationId) continue;
    work.delete("outgoing", [work.account.endpoint, work.account.principalId, record.messageId]);
  }
}

/** When this browser last acted on `deviceId`'s re-add request in the conversation. */
export async function readdHonoredAt(
  work: Work,
  workspaceId: string,
  conversationId: string,
  deviceId: string,
): Promise<number | null> {
  const record = await loadRecord(work, workspaceId, conversationId);
  return record?.readdHonored[deviceId.toLowerCase()] ?? null;
}

/** Record that this browser's accepted Commit re-added these devices. */
export async function noteReaddsHonored(
  work: Work,
  workspaceId: string,
  conversationId: string,
  devices: DeviceRefView[],
): Promise<void> {
  if (devices.length === 0) return;
  const record = await loadRecord(work, workspaceId, conversationId);
  const state = record ?? {
    ...emptyState(),
    endpoint: work.account.endpoint,
    principalId: work.account.principalId,
    workspaceId,
    conversationId,
    readdHonored: {},
  };
  const honored = { ...state.readdHonored };
  for (const device of devices) honored[device.deviceId.toLowerCase()] = Date.now();
  work.put("groups", { ...state, readdHonored: honored } satisfies GroupRecord);
}
