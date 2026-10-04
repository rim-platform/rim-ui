import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

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
    }
  }
`;

interface ServerMember {
  userId: string;
  username: string;
  memberRole: string;
  joinedAt: string;
  avatarUrl: string | null;
  statusText: string | null;
  bio: string | null;
  displayName: string | null;
}

export function useServerMembers(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.serverMembers(serverId),
    enabled: Boolean(serverId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ serverMembers: ServerMember[] }>(
        SERVER_MEMBERS_QUERY,
        { serverId: serverId! },
      );
      return res.serverMembers;
    },
  });
}
