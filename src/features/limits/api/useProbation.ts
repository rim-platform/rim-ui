import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSchemaRefusal } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";

const ME_PROBATION_QUERY = gql`
  query MeProbation {
    me {
      id
      probationEndsAt
    }
  }
`;

interface MeProbationResponse {
  me: { id: string; probationEndsAt: string | null };
}

const ME_PROFILE_LOCK_QUERY = gql`
  query MeProfileLock {
    me {
      id
      profileLockedUntil
    }
  }
`;

interface MeProfileLockResponse {
  me: { id: string; profileLockedUntil: string | null };
}

/** The longest delay `setTimeout` takes; a later end is checked again after it. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * When the signed-in account's probation ends, while it is in it; `null` otherwise, and from
 * that moment on without a reload. Asked only of a server whose `limits` report a probation.
 */
export function useProbationEnd(): string | null {
  const { limits } = useServerInfo();
  const userId = useAuthStore((s) => s.session?.userId);
  const asked = limits?.probationHours != null && userId !== undefined;
  const { data } = useQuery({
    queryKey: queryKeys.probation(userId),
    enabled: asked,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<MeProbationResponse>(ME_PROBATION_QUERY);
      return res.me.probationEndsAt;
    },
  });
  return useWhileAhead(asked ? (data ?? null) : null);
}

/**
 * Until when this server's operators locked the signed-in account's profile, while they do;
 * `null` otherwise, from the moment the lock ends without a reload, and on a server too old to
 * lock profiles.
 */
export function useProfileLock(): string | null {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery({
    queryKey: queryKeys.profileLock(userId),
    enabled: userId !== undefined,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const res = await graphqlClient.request<MeProfileLockResponse>(ME_PROFILE_LOCK_QUERY);
        return res.me.profileLockedUntil;
      } catch (err) {
        if (isSchemaRefusal(err)) return null;
        throw err;
      }
    },
  });
  return useWhileAhead(userId !== undefined ? (data ?? null) : null);
}

/** `iso` while it is still in the future; `null` otherwise, and from that moment on. */
function useWhileAhead(iso: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!iso) return;
    const end = Date.parse(iso);
    if (end <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, end - Date.now()), MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [iso, now]);

  return iso && Date.parse(iso) > now ? iso : null;
}
