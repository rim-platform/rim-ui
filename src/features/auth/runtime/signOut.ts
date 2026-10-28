/**
 * Leaving the signed-in state on this client: after a sign-out the person chose, a session the
 * server refused, or a WebSocket the server closed because the session ended.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { onWsSessionEnded } from "../../../core/graphql/wsClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useRecentActivityStore } from "../../conversations/state/useRecentActivityStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { logout } from "../api/logout";
import { useAuthStore } from "../state/useAuthStore";
import { lockAccount } from "./accountUnlock";
import { removeAccountData, signedInAccount } from "./removeAccountData";

/** What sign-in says after the server ended the session. */
export const SESSION_ENDED_MESSAGE = "Your session ended. Sign in again.";

/**
 * Back to sign-in with nothing of the session left: the account locked on this device
 * ({@link lockAccount}), no session, no open workspace, no offline mode, a fresh shell, an empty
 * recent-activity log and an empty query cache. `sessionEnded` marks a session the server ended,
 * which sign-in then says.
 */
export function signOutLocally(
  queryClient: QueryClient,
  { sessionEnded = false }: { sessionEnded?: boolean } = {},
): void {
  lockAccount();
  useOfflineStore.getState().setOffline(false);
  if (sessionEnded) {
    useAuthStore.getState().endSession();
  } else {
    useAuthStore.getState().clearSession();
  }
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
  useRecentActivityStore.getState().reset();
  queryClient.clear();
}

/**
 * The person signs out: the session ends on the server, then {@link signOutLocally}. A logout
 * the server refuses or never hears still signs out here. Without `remove` the account stays on
 * this device, its keys and cached data ready for the next sign-in; with it, everything the
 * account left here is deleted once signed out ({@link removeAccountData}), and the sign-in list
 * is read again once the account's keys are gone.
 *
 * @param queryClient - The app's query cache, emptied on the way out.
 */
export async function signOut(
  queryClient: QueryClient,
  { remove = false }: { remove?: boolean } = {},
): Promise<void> {
  const account = remove ? signedInAccount() : null;
  try {
    await logout();
  } catch {
    // An expired session or an unreachable server: signed out here all the same.
  }
  signOutLocally(queryClient);
  if (account) {
    await removeAccountData(account);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.deviceKeyAccounts(account.endpoint),
    });
  }
}

/** While mounted, a WebSocket the server closed because the session ended signs out. */
export function useSessionEndedSignOut(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onWsSessionEnded(() => {
        if (useAuthStore.getState().session) signOutLocally(queryClient, { sessionEnded: true });
      }),
    [queryClient],
  );
}
