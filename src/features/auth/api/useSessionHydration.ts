import { useEffect, useState } from "react";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSessionRefused } from "../../../core/graphql/errors";
import { isServerUnreachable } from "../../messages/api/messageCache";
import { loadSessionRecord, saveSessionRecord } from "../../offline/api/offlineSession";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useAuthStore } from "../state/useAuthStore";

const ME_QUERY = gql`
  query MeSession {
    me {
      id
    }
  }
`;

interface MeResponse {
  me: { id: string };
}

/**
 * Attempts to restore a session from an existing `rim_session` cookie.
 *
 * On app startup the Zustand auth store is empty (in-memory). If the user
 * previously logged in and the cookie is still valid, this hook calls the
 * `me` query (which sends cookies automatically) to verify the session and
 * re-populate the auth store.
 *
 * On the desktop app the session record (`offlineSession.ts`) adds two cases: after an
 * explicit sign-out the app stays on sign-in without asking the server, and when the server
 * cannot be reached the recorded account opens offline from the local cache.
 */
export function useSessionHydration() {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const [isHydrating, setIsHydrating] = useState(() => session === null);

  useEffect(() => {
    // If we already have a session there's nothing to hydrate.
    if (session !== null) {
      setIsHydrating(false);
      return;
    }

    let cancelled = false;

    async function hydrate() {
      try {
        const record = await loadSessionRecord();
        if (cancelled || record?.state === "signedOut") return;
        try {
          const res = await graphqlClient.request<MeResponse>(ME_QUERY);
          if (!cancelled && res.me?.id) {
            setSession({ userId: res.me.id });
          }
        } catch (err) {
          // The server answered: stay logged out, and when it refused the session, record that
          // so an offline start does not open the account either. It could not be reached:
          // open the recorded account offline, if there is one.
          if (cancelled || record?.state !== "signedIn") return;
          if (isServerUnreachable(err)) {
            useOfflineStore.getState().setOffline(true);
            setSession({ userId: record.userId });
          } else if (isSessionRefused(err)) {
            void saveSessionRecord({ state: "signedOut", endpoint: record.endpoint });
          }
        }
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [session, setSession]);

  return { isHydrating, isAuthenticated: session !== null };
}
