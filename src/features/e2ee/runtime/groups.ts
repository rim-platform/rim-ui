/**
 * A conversation's group, driven from the webview: the client loop, joining from Welcomes,
 * committing pending membership changes, creating a group (a new encrypted conversation, the
 * migration of an existing one, a new incarnation), checking leaves, and re-add requests.
 *
 * The Tauri side holds the state and does the cryptography; this module fetches what it needs
 * from the server and submits what it produces. Operations on one conversation run one at a
 * time (`serialize`).
 */

import { graphqlErrorCode, VALIDATION } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { trackConversation } from "../../messages/api/messageCache";
import { syncNow } from "../../messages/runtime/messageCacheSync";
import {
  ackWelcomes,
  CIPHER_SUITE,
  claimKeyPackages,
  fetchCommits,
  fetchConversationGroup,
  fetchKeyPackageStatus,
  fetchWelcomes,
  requestReadd,
  submitCommit,
  uploadKeyPackages,
  type ClaimedPackage,
  type ConversationGroupInfo,
  type ServerGroup,
} from "../api/e2eeApi";
import {
  E2eeCommandError,
  e2eeCommands,
  type DeviceRefView,
  type GroupView,
  type OutgoingCommit,
} from "../api/e2eeCommands";
import { useE2eeStore } from "../state/useE2eeStore";
import { forgetAbsence } from "./feedInputs";
import { conversationMembers, directoryFor, notReadyMembers } from "./members";
import { serialize } from "./serialize";
import type { E2eeSession } from "./session";

/** The server's answer to a Commit is `STALE_EPOCH`: another Commit won the epoch. */
export const STALE_EPOCH = "STALE_EPOCH";
/** A message needs a Commit first (pending removals, or no group yet). */
export const MLS_COMMIT_REQUIRED = "MLS_COMMIT_REQUIRED";

/** A device waits this long for a re-add before it starts a new incarnation itself. */
const RECOVERY_AFTER_MS = 10 * 60_000;
/** Attempts of a Commit that keeps losing its epoch to others. */
const COMMIT_ATTEMPTS = 3;

function lockKey(conversationId: string) {
  return `e2ee:${conversationId}`;
}

/** Run `task` alone among this conversation's encryption operations. */
export function withConversation<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
  return serialize(lockKey(conversationId), task);
}

/** Refresh what the UI knows about the conversations' groups. */
export async function refreshGroups(
  session: E2eeSession,
  workspaceId: string,
  conversationIds: string[],
): Promise<GroupView[]> {
  const groups = await e2eeCommands.status(session.account, workspaceId, conversationIds);
  for (const group of groups) useE2eeStore.getState().setGroup(group);
  return groups;
}

async function refreshGroup(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
): Promise<GroupView> {
  const [group] = await refreshGroups(session, workspaceId, [conversationId]);
  return group;
}

/** The timeline of an encrypted conversation reads the cache: show what changed there. */
export function invalidateTimeline(workspaceId: string, conversationId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.cachedTimeline(workspaceId, conversationId),
  });
}

/**
 * The client loop for one conversation: fetch its Commits, drain the feed (each entry after
 * the Commits up to its epoch), apply the Commits left.
 */
export async function catchUp(session: E2eeSession, workspaceId: string, conversationId: string) {
  await trackConversation(session.account, workspaceId, conversationId);
  await syncNow(workspaceId, [conversationId]);
  invalidateTimeline(workspaceId, conversationId);
}

// ─── Key packages ───────────────────────────────────────────────────────────

/**
 * Make sure this device has its MLS identity and enough key packages on the server: a top-up
 * below 10, a new last-resort package when needed, and `minOneTime` fresh ones (after a re-add
 * request). Uploading is also the device's activity signal.
 */
export async function refreshKeyPackages(session: E2eeSession, minOneTime = 0) {
  await e2eeCommands.ensureIdentity(session.account, session.principalId);
  const status = await fetchKeyPackageStatus().catch(() => null);
  const packages = await e2eeCommands.keyPackages(session.account, status, minOneTime);
  if (packages.length > 0) await uploadKeyPackages(packages);
}

// ─── Welcomes ───────────────────────────────────────────────────────────────

/**
 * Join every conversation a Welcome waits for: join, catch up with the Commits since, check
 * the leaves, then acknowledge. A Welcome this device cannot open leads to a re-add request.
 */
export async function processWelcomes(session: E2eeSession): Promise<string[]> {
  const welcomes = await fetchWelcomes();
  const joined: string[] = [];
  const done: string[] = [];
  for (const welcome of welcomes) {
    const { serverId, conversationId } = welcome;
    try {
      await withConversation(conversationId, async () => {
        await e2eeCommands.join(
          session.account,
          serverId,
          conversationId,
          welcome.incarnation,
          welcome.message,
        );
      });
      forgetAbsence(conversationId);
      await catchUp(session, serverId, conversationId);
      joined.push(conversationId);
    } catch (err) {
      const stale = err instanceof E2eeCommandError && err.code === "INVALID_ARGS";
      if (!stale) {
        logger.warn("[RIM:e2ee] a Welcome could not be opened; asking to be re-added:", err);
        await askToBeReadded(session, serverId, conversationId, welcome.incarnation).catch(
          (e: unknown) => logger.warn("[RIM:e2ee] re-add request failed:", e),
        );
      }
    }
    done.push(welcome.id);
  }
  await ackWelcomes(done);
  for (const welcome of welcomes) {
    if (!joined.includes(welcome.conversationId)) continue;
    await verifyLeaves(session, welcome.serverId, welcome.conversationId).catch((e: unknown) =>
      logger.warn("[RIM:e2ee] leaf check failed:", e),
    );
  }
  return joined;
}

// ─── Leaves ─────────────────────────────────────────────────────────────────

/**
 * Check the group's leaves. Devices verified before are not fetched again unless `fresh`
 * (the device list changed). A leaf that fails is checked once more against freshly fetched
 * data; one that still fails stops sending in the conversation and is removed at once.
 */
export async function verifyLeaves(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  fresh = false,
): Promise<GroupView> {
  const info = await fetchConversationGroup(workspaceId, conversationId);
  const members = await conversationMembers(workspaceId, info.memberIds);
  const principals = members.flatMap((m) => (m.principalId ? [m.principalId] : []));
  const groupPrincipals = info.mlsGroup?.devices.map((d) => d.principalId) ?? [];
  const verify = (fetched: string[]) =>
    directoryFor(principals, fetched).then((directory) =>
      e2eeCommands.verify(session.account, workspaceId, conversationId, directory),
    );

  let outcome = await verify(fresh ? [...principals, ...groupPrincipals] : []);
  if (outcome.missing.length > 0) outcome = await verify(outcome.missing);
  if (outcome.unverified.length > 0) {
    outcome = await verify(outcome.unverified.map((u) => u.principalId));
  }
  const group = await refreshGroup(session, workspaceId, conversationId);
  if (outcome.unverified.length > 0) {
    logger.warn("[RIM:e2ee] a device in the conversation does not verify:", outcome.unverified);
    const removes = outcome.unverified.filter((u) => u.principalId && u.deviceId);
    await commitPendingChanges(session, workspaceId, conversationId, { extraRemoves: removes });
  }
  return group;
}

// ─── Commits ────────────────────────────────────────────────────────────────

type SubmitResult = "accepted" | "stale" | "noAnswer" | "refused";

async function submit(
  workspaceId: string,
  conversationId: string,
  commit: OutgoingCommit,
): Promise<SubmitResult> {
  try {
    await submitCommit({
      serverId: workspaceId,
      conversationId,
      incarnation: commit.incarnation,
      epoch: commit.epoch,
      cipherSuite: commit.epoch === 0 ? commit.cipherSuite : null,
      commit: commit.commit,
      welcome: commit.welcome,
    });
    return "accepted";
  } catch (err) {
    const code = graphqlErrorCode(err);
    if (code === STALE_EPOCH) return "stale";
    if (code === undefined) return "noAnswer";
    logger.warn("[RIM:e2ee] the server refused a Commit:", err);
    return "refused";
  }
}

/**
 * Settle a submitted Commit. Without an answer, the Commit the server holds for that epoch
 * says whether this device's own Commit went through.
 */
async function settle(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  commit: OutgoingCommit,
  result: SubmitResult,
  readds: DeviceRefView[] = [],
): Promise<boolean> {
  const { account, principalId } = session;
  switch (result) {
    case "accepted":
      await e2eeCommands.settleCommit(
        account,
        principalId,
        workspaceId,
        conversationId,
        true,
        readds,
      );
      return true;
    case "stale":
    case "refused":
      await e2eeCommands.settleCommit(account, principalId, workspaceId, conversationId, false);
      return false;
    case "noAnswer": {
      const commits = await fetchCommits(
        workspaceId,
        conversationId,
        commit.incarnation,
        commit.epoch,
      ).catch(() => []);
      const atEpoch = commits.filter((c) => c.epoch === commit.epoch);
      if (atEpoch.length === 0) {
        await e2eeCommands.settleCommit(account, principalId, workspaceId, conversationId, false);
        return false;
      }
      await e2eeCommands.processCommits(account, workspaceId, conversationId, atEpoch);
      return atEpoch[0].message === commit.commit;
    }
  }
}

function claimedInputs(claimed: ClaimedPackage[]) {
  return claimed.map(({ principalId, deviceId, keyPackage }) => ({
    principalId,
    deviceId,
    keyPackage,
  }));
}

function sameDevice(a: DeviceRefView, b: DeviceRefView) {
  return a.principalId === b.principalId && a.deviceId.toLowerCase() === b.deviceId.toLowerCase();
}

/** The pending changes this device can commit in `group`: adds with a key package, removes. */
export function pendingChanges(group: ServerGroup, me: string) {
  const adds = group.pendingAdds.filter(
    (d) => d.hasKeyPackage && d.deviceId.toLowerCase() !== me.toLowerCase(),
  );
  const removes = group.pendingRemoves.filter((d) => d.deviceId.toLowerCase() !== me.toLowerCase());
  return { adds, removes };
}

interface CommitOptions {
  /** Devices to remove besides the server's pending removes (leaves that do not verify). */
  extraRemoves?: DeviceRefView[];
  /** Commit an update path even without changes (the weekly self-update). */
  selfUpdate?: boolean;
}

/**
 * Commit every pending change of the conversation's group at once, after catching up: pending
 * adds (with freshly claimed key packages), pending removes, honorable re-add requests.
 * Retries when another device's Commit wins the epoch. Returns whether a Commit went through.
 */
export function commitPendingChanges(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  options: CommitOptions = {},
): Promise<boolean> {
  return withConversation(conversationId, () =>
    commitPendingLocked(session, workspaceId, conversationId, options),
  );
}

/** {@link commitPendingChanges} for a caller that already holds the conversation. */
export async function commitPendingLocked(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  options: CommitOptions = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    await catchUp(session, workspaceId, conversationId);
    const info = await fetchConversationGroup(workspaceId, conversationId);
    const group = info.mlsGroup;
    if (!group) return false;
    const local = await refreshGroup(session, workspaceId, conversationId);
    if (!local.hasGroup || local.incarnation !== group.incarnation || local.epoch !== group.epoch) {
      return false;
    }

    const { adds, removes } = pendingChanges(group, session.deviceId);
    const extra = (options.extraRemoves ?? []).filter(
      (d) => group.devices.some((g) => sameDevice(g, d)) && !removes.some((r) => sameDevice(r, d)),
    );
    const readds = await honorableReadds(session, workspaceId, conversationId, info);
    if (adds.length + removes.length + extra.length + readds.length === 0 && !options.selfUpdate) {
      return false;
    }

    const claimed = await claimKeyPackages(workspaceId, conversationId, [
      ...adds.map(({ principalId, deviceId }) => ({ principalId, deviceId })),
      ...readds,
    ]);
    const readdsClaimed = readds.filter((r) => claimed.some((c) => sameDevice(c, r)));
    const commit = await e2eeCommands.commit(
      session.account,
      workspaceId,
      conversationId,
      claimedInputs(claimed),
      [
        ...removes.map(({ principalId, deviceId }) => ({ principalId, deviceId })),
        ...extra,
        ...readdsClaimed,
      ],
    );
    const result = await submit(workspaceId, conversationId, commit);
    if (await settle(session, workspaceId, conversationId, commit, result, readdsClaimed)) {
      await refreshGroup(session, workspaceId, conversationId);
      invalidateTimeline(workspaceId, conversationId);
      return true;
    }
    if (result === "refused") return false;
  }
  return false;
}

/** The re-add requests of the group this device may act on, verified on the Tauri side. */
async function honorableReadds(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  info: ConversationGroupInfo,
): Promise<DeviceRefView[]> {
  const requests = (info.mlsGroup?.readdRequests ?? []).filter(
    (r) => r.deviceId.toLowerCase() !== session.deviceId.toLowerCase(),
  );
  if (requests.length === 0) return [];
  const members = await conversationMembers(workspaceId, info.memberIds);
  const directory = await directoryFor(
    members.flatMap((m) => (m.principalId ? [m.principalId] : [])),
    requests.map((r) => r.principalId),
  );
  return e2eeCommands.readdCheck(
    session.account,
    workspaceId,
    conversationId,
    requests.map(({ principalId, deviceId, request }) => ({ principalId, deviceId, request })),
    directory,
  );
}

// ─── Creating a group ───────────────────────────────────────────────────────

/**
 * Create the conversation's group, or its next incarnation, with every other device that
 * belongs in it, and submit the first Commit with its Welcome. For incarnation 1 those are the
 * members' devices set up for encryption; for a later one, the current group's devices and its
 * pending adds. `first` creates only a conversation's first group (and does nothing once one
 * exists). Returns whether this device's group became the conversation's.
 */
export function createGroup(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  which: "first" | "next" = "first",
): Promise<boolean> {
  return withConversation(conversationId, () =>
    createGroupLocked(session, workspaceId, conversationId, which),
  );
}

export async function createGroupLocked(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  which: "first" | "next" = "first",
): Promise<boolean> {
  const info = await fetchConversationGroup(workspaceId, conversationId);
  if (which === "first" && info.mlsGroup) return false;
  const incarnation = (info.mlsGroup?.incarnation ?? 0) + 1;
  const targets = await groupTargets(session, workspaceId, info);
  const claimed = await claimKeyPackages(workspaceId, conversationId, targets);
  const commit = await e2eeCommands.createGroup(
    session.account,
    workspaceId,
    conversationId,
    incarnation,
    claimedInputs(claimed),
  );
  const result = await submit(workspaceId, conversationId, commit);
  const created = await settle(session, workspaceId, conversationId, commit, result);
  await refreshGroup(session, workspaceId, conversationId);
  if (created) {
    forgetAbsence(conversationId);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.conversation(workspaceId, conversationId),
    });
    invalidateTimeline(workspaceId, conversationId);
  } else if (result === "stale") {
    // Another device created it first: its Welcome brings this device in.
    await processWelcomes(session);
  }
  return created;
}

async function groupTargets(
  session: E2eeSession,
  workspaceId: string,
  info: ConversationGroupInfo,
): Promise<DeviceRefView[]> {
  const me = session.deviceId.toLowerCase();
  if (info.mlsGroup) {
    const devices = [...info.mlsGroup.devices, ...info.mlsGroup.pendingAdds].filter(
      (d) =>
        d.deviceId.toLowerCase() !== me &&
        !info.mlsGroup?.pendingRemoves.some((r) => sameDevice(r, d)),
    );
    return dedupe(devices.map(({ principalId, deviceId }) => ({ principalId, deviceId })));
  }
  const members = await conversationMembers(workspaceId, info.memberIds);
  const principals = members.flatMap((m) => (m.principalId ? [m.principalId] : []));
  const directory = await directoryFor(principals, principals);
  return directory.principals.flatMap((p) =>
    p.devices
      .filter((d) => d.mlsActive && !d.revokedAt && d.deviceId.toLowerCase() !== me)
      .map((d) => ({ principalId: p.principalId, deviceId: d.deviceId })),
  );
}

function dedupe(devices: DeviceRefView[]): DeviceRefView[] {
  const out: DeviceRefView[] = [];
  for (const device of devices) if (!out.some((d) => sameDevice(d, device))) out.push(device);
  return out;
}

// ─── Re-adds and recovery ───────────────────────────────────────────────────

/**
 * This device lost the conversation's group state (or cannot process a Commit): sign a re-add
 * request, send it, and only then upload fresh key packages for the re-add to use.
 */
export async function askToBeReadded(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  incarnation: number,
) {
  await withConversation(conversationId, async () => {
    const request = await e2eeCommands.readdRequest(
      session.account,
      session.principalId,
      workspaceId,
      conversationId,
      incarnation,
    );
    try {
      await requestReadd(workspaceId, conversationId, request);
    } catch (err) {
      if (graphqlErrorCode(err) !== VALIDATION) throw err;
      logger.warn("[RIM:e2ee] the server refused the re-add request:", err);
    }
    await refreshKeyPackages(session, 5);
  });
  await refreshGroup(session, workspaceId, conversationId);
}

/**
 * While this device waits for a re-add: once nobody has re-added it for 10 minutes, it starts a
 * new incarnation of the group itself.
 */
export async function recoverIfStuck(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const local = await refreshGroup(session, workspaceId, conversationId);
  if (!local.readdRequestedAt || Date.now() - local.readdRequestedAt < RECOVERY_AFTER_MS) {
    return false;
  }
  const info = await fetchConversationGroup(workspaceId, conversationId);
  const inGroup = info.mlsGroup?.devices.some(
    (d) => d.deviceId.toLowerCase() === session.deviceId.toLowerCase(),
  );
  if (!inGroup) return false;
  return createGroup(session, workspaceId, conversationId, "next");
}

/** Whether the group runs a suite other than the preferred one: a new incarnation moves it. */
export function needsSuiteMigration(group: ServerGroup | null): boolean {
  return Boolean(group && group.cipherSuite !== CIPHER_SUITE);
}

/** Group state of a conversation this device was removed from, or left, goes. */
export async function forgetGroup(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
) {
  await e2eeCommands.forget(session.account, workspaceId, conversationId);
  await refreshGroup(session, workspaceId, conversationId);
}

// ─── New conversations ──────────────────────────────────────────────────────

/**
 * Whether a new DM or group with `userIds` (and this user) is created encrypted: on a desktop
 * set up for encryption, when every member is ready.
 */
export async function shouldEncryptNewConversation(
  session: E2eeSession | null,
  workspaceId: string,
  userIds: string[],
): Promise<boolean> {
  if (!session) return false;
  const members = await conversationMembers(workspaceId, [...userIds, session.userId]);
  if (members.length !== new Set([...userIds, session.userId]).size) return false;
  const { names } = await notReadyMembers(members);
  return names.length === 0;
}
