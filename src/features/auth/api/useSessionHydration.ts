import { useEffect, useState } from "react";
import { gql } from "graphql-request";

import { isTauri } from "@tauri-apps/api/core";

import { graphqlClient } from "../../../core/graphql/client";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { AddressBlockedError, isSessionRefused } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { retryWithBackoff } from "../../../shared/utils/retryWithBackoff";
import { listDeviceKeyAccounts } from "../../key-identity/api/keyIdentity";
import { isServerUnreachable } from "../../messages/api/messageCache";
import {
  loadSessionRecord,
  saveSessionRecord,
  type SessionRecord,
} from "../../offline/api/offlineSession";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { restoreAfterReload } from "../runtime/reloadWindow";
import { useAuthStore } from "../state/useAuthStore";
import { accountUnlockKept } from "./accountLock";

/** What the sign-in screen says while an account that is not kept waits for the server. */
export const NEEDS_CONNECTION_MESSAGE = "Signing in needs a connection to the server";

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

/** Puts the CSRF token the record kept for `userId` back into the auth store. */
function restoreCsrfToken(record: SessionRecord | null, userId: string) {
  if (record?.state === "signedIn" && record.userId === userId && record.csrfToken) {
    useAuthStore.getState().setCsrfToken(record.csrfToken);
  }
}

/**
 * Unlocks the account `userId` with its keep key, which needs no server: whether it is kept
 * signed in on this device.
 */
async function unlockKept(userId: string): Promise<boolean> {
  try {
    const account = (await listDeviceKeyAccounts()).find((a) => a.userId === userId);
    return account ? (await accountUnlockKept(account.principalId)) !== null : false;
  } catch (err) {
    logger.warn("[RIM:auth] the kept account could not be unlocked:", err);
    return false;
  }
}

/**
 * Attempts to restore a session from an existing `rim_session` cookie.
 *
 * On app startup the Zustand auth store is empty (in-memory). If the user
 * has signed in before and the cookie is still valid, this hook calls the
 * `me` query (which sends cookies automatically) to verify the session and
 * re-populate the auth store.
 *
 * On the desktop app the session record (`offlineSession.ts`) adds two cases: after an
 * explicit sign-out the app stays on sign-in without asking the server, and when the server
 * cannot be reached the recorded account opens offline from the local cache, if it is kept
 * signed in on this device: its keep key unlocks it without the server. An account that is
 * not kept stays on sign-in with `needsConnection` set, and the server is asked again until it
 * answers. Either way the recorded CSRF token for that account goes back into the auth store.
 * When the server refuses the recorded account's session, the app stays on sign-in, where the
 * account's password signs in again.
 */
export function useSessionHydration() {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const [isHydrating, setIsHydrating] = useState(() => session === null);
  const [needsConnection, setNeedsConnection] = useState(false);
  // Bumped when the server answers again, to hydrate once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // With a session already in the store there's nothing to hydrate.
    if (session !== null) {
      setIsHydrating(false);
      return;
    }

    let cancelled = false;

    async function hydrate() {
      try {
        const record = await loadSessionRecord();
        if (cancelled || record?.state === "signedOut") return;
        // A reload within its window brings back the session secret, which `me` needs.
        if (!isTauri()) await restoreAfterReload(getGraphqlEndpoint());
        if (cancelled) return;
        try {
          const res = await graphqlClient.request<MeResponse>(ME_QUERY);
          if (!cancelled && res.me?.id) {
            restoreCsrfToken(record, res.me.id);
            setSession({ userId: res.me.id });
          }
        } catch (err) {
          // The server answered: stay logged out, and when it refused the session, record that
          // so an offline start does not open the account either. It could not be reached:
          // open the recorded account offline, if there is one. It blocked this address: stay
          // on sign-in, which says so, and keep the record.
          if (cancelled || record?.state !== "signedIn") return;
          if (err instanceof AddressBlockedError) return;
          if (isServerUnreachable(err)) {
            const kept = await unlockKept(record.userId);
            if (cancelled) return;
            if (kept) {
              useOfflineStore.getState().setOffline(true);
              restoreCsrfToken(record, record.userId);
              setSession({ userId: record.userId });
            } else {
              setNeedsConnection(true);
            }
          } else if (isSessionRefused(err)) {
            // The cookie is gone or expired: the account needs signing in, offline too.
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
  }, [session, setSession, attempt]);

  // Asks the server again until it answers, then hydrates once more.
  useEffect(() => {
    if (!needsConnection || session !== null) return;
    const retry = retryWithBackoff(
      async (stopped) => {
        try {
          await graphqlClient.request<MeResponse>(ME_QUERY);
        } catch (err) {
          if (isServerUnreachable(err)) return false;
        }
        if (!stopped()) {
          setNeedsConnection(false);
          setAttempt((n) => n + 1);
        }
        return true;
      },
      () => navigator.onLine,
    );
    const onOnline = () => retry.now();
    window.addEventListener("online", onOnline);
    return () => {
      retry.stop();
      window.removeEventListener("online", onOnline);
    };
  }, [needsConnection, session]);

  return { isHydrating, isAuthenticated: session !== null, needsConnection };
}
