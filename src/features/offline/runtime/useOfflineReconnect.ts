/**
 * Leaves offline mode once the server answers again.
 *
 * While the app runs offline (see `useSessionHydration`), the session is re-checked with the
 * `me` query on a timer, whenever the OS reports the network back, and whenever the WebSocket
 * connects. The first answer decides:
 *
 * - the session is still good: leave offline mode and refetch every query, so the sidebar and
 *   timelines replace their saved copies (the WebSocket connect also starts a cache sync);
 * - the server refused the session (it expired meanwhile): sign out to the sign-in screen;
 * - still unreachable: stay offline and try again.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { onWsConnected } from "../../../core/graphql/wsClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
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

export const OFFLINE_RECHECK_MS = 15_000;

export type SessionCheck = "online" | "signedOut" | "offline";

/** One session check: whether the server is back, and whether it still knows the user. */
export async function checkSession(userId: string): Promise<SessionCheck> {
  try {
    const res = await graphqlClient.request<{ me: { id: string } }>(SESSION_CHECK_QUERY);
    return res.me?.id === userId ? "online" : "signedOut";
  } catch (err) {
    return isServerUnreachable(err) ? "offline" : "signedOut";
  }
}

export function useOfflineReconnect() {
  const offline = useOfflineStore((s) => s.offline);
  const userId = useAuthStore((s) => s.session?.userId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!offline || !userId) return;
    let cancelled = false;
    let checking = false;

    async function recheck() {
      if (cancelled || checking) return;
      checking = true;
      try {
        const result = await checkSession(userId!);
        if (cancelled) return;
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
      } finally {
        checking = false;
      }
    }

    const timer = setInterval(() => void recheck(), OFFLINE_RECHECK_MS);
    const onOnline = () => void recheck();
    window.addEventListener("online", onOnline);
    const unsubscribeWs = onWsConnected(() => void recheck());

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      unsubscribeWs();
    };
  }, [offline, userId, queryClient]);
}
