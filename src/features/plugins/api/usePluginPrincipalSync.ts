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
}

/**
 * Tell the desktop plugin host who is signed in, so plugins see the user as a
 * protocol v1 principal. The host derives an opaque `principalId` from the
 * account id and never passes the account id itself to a plugin.
 */
export function usePluginPrincipalSync(): void {
  const { capabilities } = useRuntime();
  const sessionUserId = useAuthStore((s) => s.session?.userId ?? null);
  const { data: me } = useCurrentUser();

  // `me` can briefly belong to the previous account after a switch; wait for the match.
  const userId = sessionUserId !== null && me?.id === sessionUserId ? me.id : null;
  const displayName = userId !== null && me ? me.displayName || me.username : null;
  const pending = sessionUserId !== null && userId === null;

  useEffect(() => {
    if (!capabilities.pluginHost || pending) return;
    const user: SignedInUser | null =
      userId !== null && displayName !== null ? { userId, displayName } : null;
    void safeInvoke<null>("plugin_set_principal", { user }).then((result) => {
      if (!result.ok && result.error.kind !== "ipc_unavailable") {
        logger.warn("[RIM:Plugin] Failed to update the plugin principal", result.error);
      }
    });
  }, [capabilities.pluginHost, pending, userId, displayName]);
}
