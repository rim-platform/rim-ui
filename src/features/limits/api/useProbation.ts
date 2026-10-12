import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
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
  const endsAt = asked ? (data ?? null) : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const end = Date.parse(endsAt);
    if (end <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, end - Date.now()), MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [endsAt, now]);

  return endsAt && Date.parse(endsAt) > now ? endsAt : null;
}
