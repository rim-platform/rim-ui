/**
 * Keeping a group's devices in step with the conversation's members: pending adds and removes
 * (device links, revocations, rotations and recoveries, members added, removed, kicked,
 * banned or leaving, devices inactive for 60 days), re-add requests, the weekly self-update,
 * and a group nobody created yet. Group devices take turns by rank; the device that made a
 * membership change commits it at once.
 */

import { logger } from "../../../core/logger";
import { fetchConversationGroup, type ConversationGroupInfo } from "../api/e2eeApi";
import { useE2eeStore } from "../state/useE2eeStore";
import {
  allowedPrincipals,
  commitPendingChanges,
  createGroup,
  needsSuiteMigration,
  pendingChanges,
  recoverIfStuck,
} from "./groups";
import { pinConversation } from "./pins";
import { commitDelayMs, commitRank } from "./ranking";
import { e2eeSession, type E2eeSession } from "./session";

/** How long after an encrypted conversation's creation any member may create its group. */
const CREATOR_GRACE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** A device commits an update path at most this often per group. */
const SELF_UPDATE_EVERY_MS = 7 * DAY_MS;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function schedule(conversationId: string, delayMs: number, task: () => Promise<unknown>) {
  const previous = timers.get(conversationId);
  if (previous) clearTimeout(previous);
  timers.set(
    conversationId,
    setTimeout(() => {
      timers.delete(conversationId);
      task().catch((err: unknown) => logger.warn("[RIM:e2ee] membership sync failed:", err));
    }, delayMs),
  );
}

/**
 * This device changed the conversation's membership (added or removed members): it commits the
 * resulting device changes itself, at once. A no-op outside encrypted conversations.
 */
export function commitOwnMembershipChange(workspaceId: string, conversationId: string) {
  void e2eeSession()
    .then((session) =>
      session ? syncMembership(session, workspaceId, conversationId, { immediate: true }) : null,
    )
    .catch((err: unknown) => logger.warn("[RIM:e2ee] committing a membership change failed:", err));
}

/** Cancel every scheduled membership sync (sign-out). */
export function cancelMembershipSyncs() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/**
 * The device that ranks first for this group's pending adds: when a member's new device waits
 * to be added, that member's own other device (the lowest id among their group devices).
 */
export function firstCommitter(info: ConversationGroupInfo): string | null {
  const group = info.mlsGroup;
  if (!group) return null;
  for (const add of group.pendingAdds) {
    const own = group.devices
      .filter(
        (d) =>
          d.principalId === add.principalId &&
          !group.pendingRemoves.some((r) => r.deviceId === d.deviceId),
      )
      .map((d) => d.deviceId.toLowerCase())
      .sort();
    if (own.length > 0) return own[0];
  }
  return null;
}

/** A spread-out moment within a day after the self-update falls due, fixed per conversation. */
function selfUpdateOffset(conversationId: string): number {
  let hash = 0;
  for (const ch of conversationId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % DAY_MS;
}

/**
 * Look at the conversation's group and schedule what this device should commit there:
 * pending changes after its rank's delay (at once with `immediate`), the group itself when
 * nobody created it, the self-update when due, a new incarnation when it waits for a re-add
 * nobody honors.
 */
export async function syncMembership(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  options: { immediate?: boolean } = {},
) {
  const info = await fetchConversationGroup(workspaceId, conversationId);
  if (!info.encryptedAt) return;
  const group = info.mlsGroup;

  if (!group) {
    const age = Date.now() - Date.parse(info.encryptedAt);
    const run = () => createGroup(session, workspaceId, conversationId);
    if (options.immediate || age >= CREATOR_GRACE_MS) await run();
    else schedule(conversationId, CREATOR_GRACE_MS - age, run);
    return;
  }

  const local = (await pinConversation(session, workspaceId, info)) ?? undefined;
  if (local?.readdRequestedAt) {
    await recoverIfStuck(session, workspaceId, conversationId);
    return;
  }
  const inGroup = group.devices.some(
    (d) => d.deviceId.toLowerCase() === session.deviceId.toLowerCase(),
  );
  if (inGroup && local?.hasGroup && needsSuiteMigration(group)) {
    await createGroup(session, workspaceId, conversationId, "next");
    return;
  }

  const allowed = allowedPrincipals(info.conversationType, local);
  const { adds, removes, refused } = pendingChanges(group, session.deviceId, allowed);
  useE2eeStore.getState().setRefusedAdds(conversationId, refused);
  const pending =
    adds.length + removes.length + group.readdRequests.length + (local?.unverified.length ?? 0);
  if (pending === 0) {
    const due = (local?.lastUpdateAt ?? Date.now()) + SELF_UPDATE_EVERY_MS;
    const at = due + selfUpdateOffset(conversationId);
    if (local?.hasGroup && Date.now() >= at) {
      await commitPendingChanges(session, workspaceId, conversationId, { selfUpdate: true });
    }
    return;
  }

  const rank = commitRank(
    group.devices.map((d) => d.deviceId),
    group.pendingRemoves.map((d) => d.deviceId),
    firstCommitter(info),
    session.deviceId,
  );
  if (rank === null) return;
  const run = () => commitPendingChanges(session, workspaceId, conversationId);
  if (options.immediate) await run();
  else schedule(conversationId, commitDelayMs(rank), run);
}
