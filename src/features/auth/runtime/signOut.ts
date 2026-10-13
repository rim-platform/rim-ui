/**
 * Leaving the signed-in state on this client: after a sign-out from the user menu, a session the
 * server refused, or a WebSocket the server closed because the session ended.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { onWsSessionEnded } from "../../../core/graphql/wsClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAuthStore } from "../state/useAuthStore";

/** What sign-in says after the server ended the session. */
export const SESSION_ENDED_MESSAGE = "Your session ended. Sign in again.";

/**
 * Back to sign-in with nothing of the session left: no session, no open workspace, no offline
 * mode, a fresh shell and an empty query cache. `sessionEnded` marks a session the server ended,
 * which sign-in then says.
 */
export function signOutLocally(
  queryClient: QueryClient,
  { sessionEnded = false }: { sessionEnded?: boolean } = {},
): void {
  useOfflineStore.getState().setOffline(false);
  if (sessionEnded) {
    useAuthStore.getState().endSession();
  } else {
    useAuthStore.getState().clearSession();
  }
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
  queryClient.clear();
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
