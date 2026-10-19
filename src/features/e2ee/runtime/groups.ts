/**
 * A conversation's group, driven from the webview: the client loop, joining from Welcomes,
 * committing pending membership changes, creating a group (a new encrypted conversation, the
 * migration of an existing one, a new incarnation), checking leaves, and re-add requests.
 *
 * The Tauri side holds the state and does the cryptography; this module fetches what it needs
 * from the server and submits what it produces. Operations on one conversation run one at a
 * time (`serialize`).
 */

import { graphqlErrorCode, graphqlErrorMessage, VALIDATION } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { trackConversation } from "../../messages/api/messageCache";
import { syncNow } from "../../messages/runtime/messageCacheSync";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import {
  ackWelcomes,
  CIPHER_SUITE,
  claimKeyPackages,
  fetchCommits,
  fetchConversationGroup,
  fetchKeyPackageStatus,
  fetchWelcomePage,
  requestReadd,
  submitCommit,
  uploadKeyPackages,
  WELCOME_PAGE_SIZE,
  welcomeSources,
  type ClaimedPackage,
  type ConversationGroupInfo,
  type ServerGroup,
  type ServerWelcome,
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
import { conversationMembers, directoryFor, notReadyMembers, type MemberRead } from "./members";
import { directPair, pinConversation } from "./pins";
import { serialize } from "./serialize";
import type { E2eeSession } from "./session";

/** The server's answer to a Commit is `STALE_EPOCH`: another Commit won the epoch. */
export const STALE_EPOCH = "STALE_EPOCH";
/** A message needs a Commit first (pending removals, or no group yet). */
export const MLS_COMMIT_REQUIRED = "MLS_COMMIT_REQUIRED";
/** The server's refusal of a first Commit that leaves a member without a device in the group. */
export const MEMBER_WITHOUT_DEVICE = "every member needs at least one device in the group";
/** The end of the server's refusal of a Commit whose Welcome an added device has no room for. */
export const TOO_MANY_PENDING_WELCOMES = "has too many pending Welcomes";

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

/** The backend refused a Welcome as older than the state this device holds. */
const STALE_WELCOME_CODES = new Set(["INVALID_ARGS", "E2EE_STALE_WELCOME"]);

/**
 * Whether this device holds working state of the Welcome's incarnation: then a Welcome that does
 * not open is a replay or a leftover, never a reason to ask for a re-add.
 */
async function holdsWorkingGroup(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  incarnation: number,
): Promise<boolean> {
  const [local] = await e2eeCommands
    .status(session.account, workspaceId, [conversationId])
    .catch(() => []);
  return Boolean(
    local?.hasGroup &&
    local.incarnation === incarnation &&
    local.awaitingReadd === null &&
    local.readdRequestedAt === null,
  );
}

/** Pages of Welcomes read from one server in one pass: 300, past the 256 a device may hold. */
const WELCOME_PAGES = 3;

/**
 * Join every conversation a Welcome waits for, on this relay and then on each other host: join,
 * catch up with the Commits since, acknowledge, check the leaves. A Welcome this device cannot
 * open leads to a re-add request, unless the device already holds working state of that
 * incarnation (a replayed Welcome). This relay's failures reject; a host that does not answer is
 * asked again next time.
 *
 * @returns The conversations joined.
 */
export async function processWelcomes(session: E2eeSession): Promise<string[]> {
  const joined: string[] = [];
  for (const host of welcomeSources()) {
    try {
      await processHostWelcomes(session, host, joined);
    } catch (err) {
      if (host === null) throw err;
      logger.warn(`[RIM:e2ee] Welcomes on ${host} could not be processed:`, err);
    }
  }
  return joined;
}

/**
 * The Welcomes on one server (`null` for this relay), a page at a time and at most
 * {@link WELCOME_PAGES} pages. Every Welcome of a page is acknowledged, whatever became of it,
 * before the leaves of the conversations it joined are checked. A page after the first starts
 * after the last Welcome read, so a page is never read twice in one pass, even when its
 * acknowledgement did not take; a page shorter than {@link WELCOME_PAGE_SIZE} is the last.
 *
 * @param joined - Receives the conversations joined.
 */
async function processHostWelcomes(session: E2eeSession, host: string | null, joined: string[]) {
  let after: ServerWelcome | null = null;
  for (let page = 0; page < WELCOME_PAGES; page += 1) {
    const welcomes = await fetchWelcomePage(host, after);
    const opened: ServerWelcome[] = [];
    for (const welcome of welcomes) {
      if (await joinFromWelcome(session, welcome)) opened.push(welcome);
    }
    joined.push(...opened.map((w) => w.conversationId));
    await ackWelcomes(
      host,
      welcomes.map((w) => w.id),
    );
    const checked = new Set<string>();
    for (const { serverId, conversationId } of opened) {
      if (checked.has(conversationId)) continue;
      checked.add(conversationId);
      await verifyLeaves(session, serverId, conversationId).catch((e: unknown) =>
        logger.warn("[RIM:e2ee] leaf check failed:", e),
      );
    }
    if (welcomes.length < WELCOME_PAGE_SIZE) return;
    after = welcomes[welcomes.length - 1];
  }
}

/**
 * Join the conversation of one Welcome and catch up with the Commits since. A Welcome that does
 * not open asks for a re-add unless it is stale or a replay.
 *
 * @returns Whether the conversation was joined.
 */
async function joinFromWelcome(session: E2eeSession, welcome: ServerWelcome): Promise<boolean> {
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
    return true;
  } catch (err) {
    const stale =
      (err instanceof E2eeCommandError && STALE_WELCOME_CODES.has(err.code)) ||
      (await holdsWorkingGroup(session, serverId, conversationId, welcome.incarnation));
    if (stale) {
      logger.warn("[RIM:e2ee] ignoring a Welcome older than this device's state:", err);
    } else {
      logger.warn("[RIM:e2ee] a Welcome could not be opened; asking to be re-added:", err);
      await askToBeReadded(session, serverId, conversationId, welcome.incarnation).catch(
        (e: unknown) => logger.warn("[RIM:e2ee] re-add request failed:", e),
      );
    }
    return false;
  }
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
  const memberPrincipals = (read?: MemberRead) =>
    conversationMembers(workspaceId, info.memberIds, read).then((members) =>
      members.flatMap((m) => (m.principalId ? [m.principalId] : [])),
    );
  let principals = await memberPrincipals();
  const groupPrincipals = info.mlsGroup?.devices.map((d) => d.principalId) ?? [];
  const verify = (fetched: string[]) =>
    directoryFor(principals, fetched).then((directory) =>
      e2eeCommands.verify(session.account, workspaceId, conversationId, directory),
    );

  let outcome = await verify(fresh ? [...principals, ...groupPrincipals] : []);
  if (outcome.missing.length > 0) outcome = await verify(outcome.missing);
  if (outcome.unverified.length > 0) {
    // The member list is fetched again too: a member who just joined is not in an older copy.
    principals = await memberPrincipals({ fresh: true });
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

/**
 * How the server answered a Commit; `membersMissing` is a first Commit leaving a member out,
 * `welcomesFull` a Commit adding a device that has no room for one more Welcome.
 */
type SubmitResult =
  "accepted" | "stale" | "noAnswer" | "refused" | "membersMissing" | "welcomesFull";

/** Whether `err` refuses a first Commit because a member has no device in the group. */
function leavesMemberOut(commit: OutgoingCommit, err: unknown): boolean {
  return (
    commit.epoch === 0 &&
    graphqlErrorCode(err) === VALIDATION &&
    graphqlErrorMessage(err, "") === MEMBER_WITHOUT_DEVICE
  );
}

/** Whether `err` refuses a Commit because an added device holds too many pending Welcomes. */
function addsFullDevice(err: unknown): boolean {
  return (
    graphqlErrorCode(err) === VALIDATION &&
    graphqlErrorMessage(err, "").endsWith(TOO_MANY_PENDING_WELCOMES)
  );
}

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
    if (leavesMemberOut(commit, err)) return "membersMissing";
    return addsFullDevice(err) ? "welcomesFull" : "refused";
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
    case "membersMissing":
    case "welcomesFull":
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

/**
 * The principals a conversation's devices may belong to: a direct message's two pinned
 * principals (none while it has no pin), or anyone (`null`) in a group.
 */
export function allowedPrincipals(
  conversationType: string,
  local: Pick<GroupView, "dmPrincipals"> | undefined,
): string[] | null {
  if (conversationType !== ConversationTypeEnum.DIRECT) return null;
  return local?.dmPrincipals ?? [];
}

/**
 * The pending changes this device can commit in `group`: adds with a key package, removes. In a
 * direct message, adds of principals other than its two are `refused`, never committed.
 */
export function pendingChanges(group: ServerGroup, me: string, allowed: string[] | null = null) {
  const others = group.pendingAdds.filter(
    (d) => d.hasKeyPackage && d.deviceId.toLowerCase() !== me.toLowerCase(),
  );
  const adds = others.filter((d) => !allowed || allowed.includes(d.principalId));
  const refused = [
    ...new Set(
      group.pendingAdds
        .filter((d) => allowed && !allowed.includes(d.principalId))
        .map((d) => d.principalId),
    ),
  ].sort();
  const removes = group.pendingRemoves.filter((d) => d.deviceId.toLowerCase() !== me.toLowerCase());
  return { adds, removes, refused };
}

interface CommitOptions {
  /** Devices to remove besides the server's pending removes (leaves that do not verify). */
  extraRemoves?: DeviceRefView[];
  /** Commit an update path even without changes (the weekly self-update). */
  selfUpdate?: boolean;
}

/**
 * Commit every pending change of the conversation's group at once, after catching up: pending
 * adds (with freshly claimed key packages), pending removes, honorable re-add requests. A pending
 * add the claim leaves out (no key package, or no room for one more Welcome) waits for a later
 * round, and nothing is committed when nothing else is left. Retries, at most 3 times in all,
 * when another device's Commit wins the epoch or an added device ran out of room for Welcomes
 * since the claim. Returns whether a Commit went through.
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

    const allowed = allowedPrincipals(info.conversationType, local);
    const { adds, removes, refused } = pendingChanges(group, session.deviceId, allowed);
    useE2eeStore.getState().setRefusedAdds(conversationId, refused);
    if (refused.length > 0) {
      logger.warn("[RIM:e2ee] the server lists adds outside this direct message:", refused);
    }
    const extra = (options.extraRemoves ?? []).filter(
      (d) => group.devices.some((g) => sameDevice(g, d)) && !removes.some((r) => sameDevice(r, d)),
    );
    const readds = await honorableReadds(session, workspaceId, conversationId, info);
    if (adds.length + removes.length + extra.length + readds.length === 0 && !options.selfUpdate) {
      return false;
    }

    const claimed = await claimWithReadds(workspaceId, conversationId, adds, readds);
    const readdsClaimed = readds.filter((r) => claimed.some((c) => sameDevice(c, r)));
    if (claimed.length + removes.length + extra.length === 0 && !options.selfUpdate) {
      return false;
    }
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
    if (result === "refused" || result === "membersMissing") return false;
  }
  return false;
}

/**
 * Claim key packages for the adds and the re-adds. A re-add target that has not uploaded a
 * package since its request fails the whole claim (`VALIDATION`); the adds are claimed alone
 * then, and the re-add waits for a later round.
 */
async function claimWithReadds(
  workspaceId: string,
  conversationId: string,
  adds: DeviceRefView[],
  readds: DeviceRefView[],
): Promise<ClaimedPackage[]> {
  const addRefs = adds.map(({ principalId, deviceId }) => ({ principalId, deviceId }));
  try {
    return await claimKeyPackages(workspaceId, conversationId, [...addRefs, ...readds]);
  } catch (err) {
    if (readds.length === 0 || graphqlErrorCode(err) !== VALIDATION) throw err;
    logger.warn("[RIM:e2ee] a re-add target has no fresh key package yet:", err);
    return claimKeyPackages(workspaceId, conversationId, addRefs);
  }
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
  const members = await conversationMembers(workspaceId, info.memberIds, { fresh: true });
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
  return withConversation(conversationId, async () => {
    const { created } = await createGroupLocked(session, workspaceId, conversationId, which);
    return created;
  });
}

/** Whether the group was created, and who kept it from being created. */
export interface GroupCreation {
  created: boolean;
  /** Members the server wants in the group who have no device set up for encryption. */
  notReady: string[];
}

/**
 * {@link createGroup} for a caller that already holds the conversation, naming the members the
 * first Commit could not include. A Commit the server refuses for leaving a member out, or for
 * adding a device with no room for one more Welcome (which the next claim leaves out), is built
 * once more from freshly fetched members and devices; when that one is refused for leaving a
 * member out, the members who are not ready are named.
 */
export async function createGroupLocked(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  which: "first" | "next" = "first",
): Promise<GroupCreation> {
  let attempt = await createGroupOnce(session, workspaceId, conversationId, which);
  if (attempt.result === "membersMissing") {
    logger.warn("[RIM:e2ee] the first Commit left a member out; building it again");
    await forgetMembers(workspaceId, attempt.members);
  } else if (attempt.result === "welcomesFull") {
    logger.warn("[RIM:e2ee] an added device has no room for the Welcome; building it again");
  } else {
    return { created: attempt.created, notReady: [] };
  }
  attempt = await createGroupOnce(session, workspaceId, conversationId, which);
  if (attempt.result !== "membersMissing") return { created: attempt.created, notReady: [] };
  const others = attempt.members.filter((m) => m.userId !== session.userId);
  const { names } = await notReadyMembers(others);
  return { created: false, notReady: names };
}

/** Drop the cached member list and the cached identities of `members` from other relays. */
async function forgetMembers(workspaceId: string, members: ServerMember[]) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.serverMembers(workspaceId),
    refetchType: "none",
  });
  for (const member of members) {
    if (!member.principalId) continue;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.remoteIdentity(member.principalId),
      refetchType: "none",
    });
  }
}

/** One try at creating the group: the server's answer and the members it was built from. */
async function createGroupOnce(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  which: "first" | "next",
): Promise<{ created: boolean; result: SubmitResult | null; members: ServerMember[] }> {
  const info = await fetchConversationGroup(workspaceId, conversationId);
  if (which === "first" && info.mlsGroup) return { created: false, result: null, members: [] };
  const incarnation = (info.mlsGroup?.incarnation ?? 0) + 1;
  // Fetched now, not read from a copy: a member missing from the group fails its first Commit.
  // The pin and the direct pair below read the list just cached.
  const members = await conversationMembers(workspaceId, info.memberIds, { fresh: true });
  // A direct message holds its two principals: pinned, or (before it is encrypted) the two the
  // server lists.
  const local = await pinConversation(session, workspaceId, info);
  const allowed =
    local?.dmPrincipals ??
    (info.conversationType === ConversationTypeEnum.DIRECT
      ? ((await directPair(session, workspaceId, info)) ?? [])
      : null);
  const targets = (await groupTargets(session, info, members)).filter(
    (d) => !allowed || allowed.includes(d.principalId),
  );
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
  return { created, result, members };
}

async function groupTargets(
  session: E2eeSession,
  info: ConversationGroupInfo,
  members: ServerMember[],
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
 * Whether every member of a DM or group with `userIds` (and this user) has a device set up for
 * encryption: what upgrading an existing plaintext one needs.
 */
export async function allMembersReady(
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
