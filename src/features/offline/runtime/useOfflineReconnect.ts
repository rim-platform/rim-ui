/**
 * Leaves offline mode once the server answers again.
 *
 * While the app runs offline (see `useSessionHydration`), the session is re-checked with the
 * `me` query on a timer, and right away whenever the OS reports the network back, the window is
 * shown again, or the WebSocket connects. The timer starts at 15 seconds and doubles after each
 * check that still finds the server unreachable, up to two minutes; it skips its check while
 * the OS reports no network or the window is hidden. The first answer decides:
 *
 * - the session is still good: leave offline mode and refetch every query, so the sidebar and
 *   timelines replace their saved copies (the WebSocket connect also starts a cache sync);
 * - the server refused the session (it expired meanwhile): sign in again with this device's key
 *   when it holds one for the account, else sign out to the sign-in screen;
 * - still unreachable, or an answer that says nothing about the session (an internal error):
 *   stay offline and try again.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSessionRefused } from "../../../core/graphql/errors";
import { onWsConnected } from "../../../core/graphql/wsClient";
import { retryWithBackoff } from "../../../shared/utils/retryWithBackoff";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { resumeWithDeviceKey } from "../../key-identity/api/keyIdentity";
import { isServerUnreachable } from "../../messages/api/messageCache";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useOfflineStore } from "../state/useOfflineStore";

const SESSION_CHECK_QUERY = gql`
  query OfflineSessionCheck {
    me {
      id
    }
  }
`;

export type SessionCheck = "online" | "signedOut" | "offline";

/** One session check: whether the server is back, and whether it still knows the user. */
export async function checkSession(userId: string): Promise<SessionCheck> {
  try {
    const res = await graphqlClient.request<{ me: { id: string } }>(SESSION_CHECK_QUERY);
    return res.me?.id === userId ? "online" : "signedOut";
  } catch (err) {
    if (isServerUnreachable(err) || !isSessionRefused(err)) return "offline";
    return (await resumeWithDeviceKey(userId)) === userId ? "online" : "signedOut";
  }
}

export function useOfflineReconnect() {
  const offline = useOfflineStore((s) => s.offline);
  const userId = useAuthStore((s) => s.session?.userId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!offline || !userId) return;

    /** One check; `true` once the app is no longer offline. */
    async function recheck(stopped: () => boolean): Promise<boolean> {
      const result = await checkSession(userId!);
      if (stopped()) return true;
      if (result === "online") {
        useOfflineStore.getState().setOffline(false);
        void queryClient.invalidateQueries();
      } else if (result === "signedOut") {
        useOfflineStore.getState().setOffline(false);
        // As a sign-out from the user menu: back to sign-in with nothing of the session left.
        useAuthStore.getState().clearSession();
        useWorkspaceStore.getState().clearWorkspaceId();
        useShellStore.getState().reset();
        queryClient.clear();
      }
      return result !== "offline";
    }

    // The `online` and `visibilitychange` events check as soon as it is worth it.
    const retry = retryWithBackoff(recheck, () => navigator.onLine && !document.hidden);
    /** The network, the window or the WebSocket came back: check now. */
    const onSignal = () => {
      if (!document.hidden) retry.now();
    };
    window.addEventListener("online", onSignal);
    document.addEventListener("visibilitychange", onSignal);
    const unsubscribeWs = onWsConnected(onSignal);

    return () => {
      retry.stop();
      window.removeEventListener("online", onSignal);
      document.removeEventListener("visibilitychange", onSignal);
      unsubscribeWs();
    };
  }, [offline, userId, queryClient]);
}
