/**
 * A browser that comes back after more than 60 days: the other devices have removed it from
 * its groups (a device without a key package upload for 60 days is removed), or are about to.
 * Where the server still counts it in a group it asks to be re-added; elsewhere its old group
 * state goes. Its fresh key packages then make it a pending add, and it joins through the
 * Welcomes. What was sent meanwhile is not readable in this browser.
 */

import { logger } from "../../../core/logger";
import { fetchConversationGroup } from "../api/e2eeApi";
import { isWebAccount } from "../web/webAccount";
import { askToBeReadded, forgetGroup } from "./groups";
import type { E2eeSession } from "./session";

/** How long a browser may go unused before it counts as gone from its groups. */
export const ABSENCE_MS = 60 * 24 * 60 * 60_000;

/** Note that this browser runs now; after an absence, leave or re-join its groups first. */
export async function returnAfterAbsence(session: E2eeSession): Promise<boolean> {
  const account = session.account;
  if (!isWebAccount(account)) return false;
  const { groupsOf, touchAccount } = await import("../web/webCommands");
  const last = await touchAccount(account);
  if (last === null || Date.now() - last < ABSENCE_MS) return false;
  for (const group of await groupsOf(account)) {
    if (group.incarnation === 0) continue;
    try {
      const info = await fetchConversationGroup(group.workspaceId, group.conversationId);
      const server = info.mlsGroup;
      const counted =
        server?.incarnation === group.incarnation &&
        server.devices.some((d) => d.deviceId.toLowerCase() === session.deviceId.toLowerCase());
      if (counted) {
        await askToBeReadded(session, group.workspaceId, group.conversationId, group.incarnation);
      } else {
        await forgetGroup(session, group.workspaceId, group.conversationId);
      }
    } catch (err) {
      logger.warn("[RIM:e2ee] rejoining a conversation after an absence failed:", err);
    }
  }
  return true;
}
