/**
 * Removing an account from this device: its keys, its encrypted store and message cache, its
 * relay state, its web plugins' data and what this app remembers for it in local storage, so
 * the next sign-in starts as on a device that never held the account.
 */

import { isTauri } from "@tauri-apps/api/core";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { resetE2eeSession } from "../../e2ee/runtime/session";
import { deleteAccount } from "../../e2ee/web/db";
import { keyBackend } from "../../key-identity/api/keyBackend";
import { storedEndpoint } from "../../key-identity/browser/keyStore";
import { forgetKeySetupDeferral } from "../../key-identity/state/keySetupOffer";
import { removeCachedAccount } from "../../messages/api/messageCache";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { saveSessionRecord } from "../../offline/api/offlineSession";
import { browserPluginStore } from "../../plugins/web/browserPluginStore";
import { provisionalPrincipalId } from "../../plugins/web/principal";
import { forgetPendingRemoteJoins } from "../../relay/remote/pendingRemoteJoins";
import { deleteAccountRecords } from "../../relay/state/relayDb";
import { useRelayStore, type RelayAccount } from "../../relay/state/useRelayStore";
import { removalAccountKey, useRemovalNotices } from "../../workspaces/state/useRemovalNotices";
import { useAuthStore } from "../state/useAuthStore";

/** An account to remove from this device. */
export interface DeviceAccount {
  /** The GraphQL endpoint the account signs in at. */
  endpoint: string;
  userId: string;
  /** The account as the relay ran for it, when it did. */
  relay: RelayAccount | null;
}

/**
 * The signed-in account, read before signing out clears it.
 *
 * @returns The account, or `null` with nobody signed in.
 */
export function signedInAccount(): DeviceAccount | null {
  const userId = useAuthStore.getState().session?.userId;
  if (!userId) return null;
  const relay = useRelayStore.getState().account;
  return {
    endpoint: getGraphqlEndpoint(),
    userId,
    relay: relay?.userId === userId ? relay : null,
  };
}

/**
 * The principals this device holds for the account, each with this device's id under it: those
 * of the local keys signed in as the account, and the relay's.
 */
async function principalsOf(account: DeviceAccount): Promise<Map<string, string | null>> {
  const principals = new Map<string, string | null>();
  for (const local of await keyBackend().accounts(account.endpoint)) {
    if (local.userId === account.userId) principals.set(local.principalId, local.deviceId);
  }
  const relay = account.relay;
  if (relay && !principals.has(relay.principalId)) {
    principals.set(relay.principalId, relay.deviceId);
  }
  return principals;
}

/**
 * Delete everything `account` left on this device. Every part is attempted even when another
 * fails; a failure is logged and, once all are done, told to the person in one warning.
 * Drafts go entirely, since they are not kept per account.
 *
 * @param account - The account, as {@link signedInAccount} read it before signing out.
 */
export async function removeAccountData(account: DeviceAccount): Promise<void> {
  const { endpoint, userId } = account;
  const desktop = isTauri();
  const relayEndpoint = account.relay?.endpoint ?? endpoint;
  const parts: [string, () => Promise<unknown> | void][] = [];

  for (const [principalId, deviceId] of await principalsOf(account)) {
    const relayAccount = `${relayEndpoint}|${principalId}`;
    parts.push(["keys", () => keyBackend().forget(principalId)]);
    if (!desktop) {
      parts.push(["encrypted store", () => deleteAccount(storedEndpoint(endpoint), principalId)]);
    }
    parts.push(["relay state", () => deleteAccountRecords(relayAccount, deviceId)]);
    parts.push(["pending join requests", () => forgetPendingRemoteJoins(relayAccount)]);
  }
  if (desktop) {
    parts.push(["message cache", () => removeCachedAccount({ endpoint, userId })]);
    parts.push(["session record", () => saveSessionRecord({ state: "signedOut", endpoint })]);
  } else {
    parts.push([
      "plugins",
      async () => browserPluginStore.removeAccount(await provisionalPrincipalId(userId)),
    ]);
  }
  parts.push([
    "removal notices",
    () => useRemovalNotices.getState().forget(removalAccountKey(userId)),
  ]);
  parts.push(["key setup choice", () => forgetKeySetupDeferral(userId)]);
  parts.push([
    "drafts",
    () => {
      useDraftStore.setState({ drafts: {} });
      return useDraftStore.persist.clearStorage();
    },
  ]);

  let failed = false;
  for (const [what, remove] of parts) {
    try {
      await remove();
    } catch (err) {
      failed = true;
      logger.warn(`[RIM:auth] removing the account's ${what} from this device failed:`, err);
    }
  }
  resetE2eeSession();
  if (failed) {
    toast.warning("Some of this account's data could not be removed from this device", {
      description: "Sign in and sign out with removal again to retry.",
    });
  }
}
