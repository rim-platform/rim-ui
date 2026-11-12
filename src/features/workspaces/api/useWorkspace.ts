import { queryOptions, useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";

const SERVER_QUERY = gql`
  query Server($serverId: ID!) {
    server(serverId: $serverId) {
      id
      name
      viewerRole
    }
  }
`;

export interface ServerDetail {
  id: string;
  name: string;
  viewerRole: ServerMemberRoleGql;
}

interface ServerResponse {
  server: ServerDetail;
}

/** The `server` query of a workspace: its name and the viewer's role in it. */
export function workspaceQueryOptions(workspaceId?: string) {
  return queryOptions({
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

export function useWorkspace(workspaceId?: string) {
  return useQuery(workspaceQueryOptions(workspaceId));
}
