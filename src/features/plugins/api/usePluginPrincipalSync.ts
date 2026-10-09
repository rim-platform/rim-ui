import { useEffect } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { logger } from "../../../core/logger";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";

/** The signed-in user as the plugin host needs it; `null` when signed out. */
export interface SignedInUser {
  userId: string;
  displayName: string;
  /** The key-based id (`rimp1_…`) once the account enrolled a key; the host then uses it. */
  principalId: string | null;
}

/**
 * Tell the desktop plugin host who is signed in, so plugins see the user as a
 * protocol v1 principal. Until the account enrolls a key the host derives a
 * provisional `rimp0_` id from the account id (and never passes the account id
 * itself to a plugin); afterwards it uses the account's `rimp1_` id and tells
 * plugins which old id it replaced.
 */
export function usePluginPrincipalSync(): void {
  const { capabilities } = useRuntime();
  const sessionUserId = useAuthStore((s) => s.session?.userId ?? null);
  const { data: me } = useCurrentUser();

  // `me` can briefly belong to the previous account after a switch; wait for the match.
  const userId = sessionUserId !== null && me?.id === sessionUserId ? me.id : null;
  const displayName = userId !== null && me ? me.displayName || me.username : null;
  const principalId = userId !== null ? (me?.principalId ?? null) : null;
  const pending = sessionUserId !== null && userId === null;

  useEffect(() => {
    if (!capabilities.pluginHost || pending) return;
    const user: SignedInUser | null =
      userId !== null && displayName !== null ? { userId, displayName, principalId } : null;
    void safeInvoke<null>("plugin_set_principal", { user }).then((result) => {
      if (!result.ok && result.error.kind !== "ipc_unavailable") {
        logger.warn("[RIM:Plugin] Failed to update the plugin principal", result.error);
      }
    });
  }, [capabilities.pluginHost, pending, userId, displayName, principalId]);
}
