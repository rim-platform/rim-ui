import { useEffect, useRef } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { logger } from "../../../core/logger";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { browserPluginStore } from "../web/browserPluginStore";
import { principalOf, provisionalPrincipalId } from "../web/principal";
import { pluginServices } from "../web/webPluginEnvironment";
import { webPluginHost } from "../web/webPluginHost";

/** The signed-in user as the plugin host needs it; `null` when signed out. */
export interface SignedInUser {
  userId: string;
  displayName: string;
  /** The key-based id (`rimp1_…`) once the account enrolled a key; the host then uses it. */
  principalId: string | null;
}

/**
 * Tell the plugin hosts who is signed in, so plugins see the user as a
 * protocol v1 principal. Until the account enrolls a key the hosts derive a
 * provisional `rimp0_` id from the account id (and never pass the account id
 * itself to a plugin); afterwards they use the account's `rimp1_` id and tell
 * plugins which old id it replaced. On the web the signed-in account also
 * chooses which web plugins are installed.
 */
export function usePluginPrincipalSync(): void {
  const { platform, capabilities } = useRuntime();
  const sessionUserId = useAuthStore((s) => s.session?.userId ?? null);
  const { data: me } = useCurrentUser();

  // `me` can briefly belong to the previous account after a switch; wait for the match.
  const userId = sessionUserId !== null && me?.id === sessionUserId ? me.id : null;
  const displayName = userId !== null && me ? me.displayName || me.username : null;
  const principalId = userId !== null ? (me?.principalId ?? null) : null;
  const pending = sessionUserId !== null && userId === null;
  // The desktop host's last principal update. Web plugins on the desktop read their
  // settings from that host for its signed-in account, so they hear of a new principal
  // only once it has one.
  const hostPrincipal = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!capabilities.pluginHost || pending) return;
    const user: SignedInUser | null =
      userId !== null && displayName !== null ? { userId, displayName, principalId } : null;
    hostPrincipal.current = safeInvoke<null>("plugin_set_principal", { user }).then((result) => {
      if (!result.ok && result.error.kind !== "ipc_unavailable") {
        logger.warn("[RIM:Plugin] Failed to update the plugin principal", result.error);
      }
    });
  }, [capabilities.pluginHost, pending, userId, displayName, principalId]);

  useEffect(() => {
    if (!capabilities.webPlugins || pending) return;
    let live = true;
    const user: SignedInUser | null =
      userId !== null && displayName !== null ? { userId, displayName, principalId } : null;
    void (async () => {
      const principal = user ? await principalOf(user) : null;
      if (platform === "web") {
        const account = user ? await provisionalPrincipalId(user.userId) : null;
        if (account !== null && principal !== null && principal.principalId !== account) {
          await browserPluginStore.recordMapping(account, principal.principalId);
        }
        if (!live) return;
        browserPluginStore.setAccount(account);
        void queryClient.invalidateQueries({ queryKey: queryKeys.plugins() });
      }
      if (platform === "desktop") await hostPrincipal.current;
      if (!live) return;
      webPluginHost.setPrincipal(principal);
      webPluginHost.setMappings(await pluginServices(platform).mappings());
    })().catch((error: unknown) => {
      logger.warn("[RIM:Plugin] Failed to update the web plugin principal", error);
    });
    return () => {
      live = false;
    };
  }, [capabilities.webPlugins, platform, pending, userId, displayName, principalId]);
}
