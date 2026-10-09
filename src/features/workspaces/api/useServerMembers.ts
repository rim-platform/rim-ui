import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { withOfflineSnapshot } from "../../offline/api/offlineSnapshot";

const SERVER_MEMBERS_QUERY = gql`
  query ServerMembers($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      username
      memberRole
      joinedAt
      avatarUrl
      statusText
      bio
      displayName
      timeoutUntil
    }
  }
`;

export interface ServerMember {
  userId: string;
  username: string;
  memberRole: ServerMemberRoleGql;
  joinedAt: string;
  avatarUrl: string | null;
  statusText: string | null;
  bio: string | null;
  displayName: string | null;
  /** End of the member's timeout while one is in force, else null (Track 1.2). */
  timeoutUntil?: string | null;
}

export function useServerMembers(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.serverMembers(serverId),
    enabled: Boolean(serverId),
    staleTime: 60_000,
    // Runs offline too: the desktop app answers from its saved copy (offlineSnapshot.ts).
    networkMode: "offlineFirst",
    queryFn: () =>
      withOfflineSnapshot("members", serverId!, async () => {
        const res = await graphqlClient.request<{ serverMembers: ServerMember[] }>(
          SERVER_MEMBERS_QUERY,
          { serverId: serverId! },
        );
        return res.serverMembers;
      }),
  });
}
