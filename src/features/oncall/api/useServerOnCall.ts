import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { OnCallNowGql } from "../../../core/graphql/generated/schema-types";

export type OnCallNow = OnCallNowGql;

const SERVER_ON_CALL_QUERY = gql`
  query ServerOnCall($serverId: ID!) {
    serverOnCall(serverId: $serverId) {
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
 * Batch "who's on call across every schedule on this server", in one call (no N+1 of
 * individual {@link useWhoIsOnCall} calls). Powers the status-bar `OnCallIndicator` and the
 * `oncall.who` command panel. Any workspace member may read.
 *
 * **Note:** `OnCallNowGql` does not carry a schedule name (only `scheduleId`) — join
 * against {@link useOnCallSchedules} if a name needs to be displayed alongside an entry.
 */
export function useServerOnCall(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.serverOnCall(serverId),
    enabled: Boolean(serverId),
    staleTime: 15_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ serverOnCall: OnCallNow[] }>(SERVER_ON_CALL_QUERY, {
        serverId: serverId!,
      });
      return res.serverOnCall;
    },
  });
}
