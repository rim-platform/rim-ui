import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const SERVER_QUERY = gql`
  query Server($serverId: ID!) {
    server(serverId: $serverId) {
      id
      name
    }
  }
`;

interface ServerDetail {
  id: string;
  name: string;
}

interface ServerResponse {
  server: ServerDetail;
}

export function useWorkspace(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.server(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ServerResponse>(SERVER_QUERY, {
        serverId: workspaceId!,
      });
      return res.server;
    },
  });
}
