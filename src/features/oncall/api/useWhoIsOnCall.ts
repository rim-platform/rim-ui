import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { OnCallNow } from "./useServerOnCall";

const WHO_IS_ON_CALL_QUERY = gql`
  query WhoIsOnCall($scheduleId: ID!, $at: DateTime) {
    whoIsOnCall(scheduleId: $scheduleId, at: $at) {
      scheduleId
      shiftEndsAt
      currentUser {
        id
        username
        displayName
        avatarUrl
      }
      nextUser {
        id
        username
        displayName
        avatarUrl
      }
    }
  }
`;

/**
 * Resolves who is on call for a single schedule right now (or at `at`, if given). Powers
 * the {@link OverrideModal}'s default end (`shiftEndsAt`) and a single schedule's detail
 * view. Any workspace member may read.
 */
export function useWhoIsOnCall(scheduleId?: string, at?: string) {
  return useQuery({
    queryKey: queryKeys.whoIsOnCall(scheduleId, at),
    enabled: Boolean(scheduleId),
    staleTime: 15_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ whoIsOnCall: OnCallNow }>(WHO_IS_ON_CALL_QUERY, {
        scheduleId: scheduleId!,
        at,
      });
      return res.whoIsOnCall;
    },
  });
}
