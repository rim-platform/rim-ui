import { useEffect, useState } from "react";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
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
        const res = await graphqlClient.request<MeResponse>(ME_QUERY);
        if (!cancelled && res.me?.id) {
          setSession({ userId: res.me.id });
        }
      } catch {
        // 401 or network error — cookie invalid or absent, stay logged out.
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
