import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";
import { useEffect } from "react";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { usePresenceStore, type PresenceStatus } from "../state/usePresenceStore";

const WORKSPACE_PRESENCE_QUERY = gql`
  query WorkspacePresence($workspaceId: ID!) {
    workspacePresence(workspaceId: $workspaceId) {
      userId
      status
      lastSeenAt
    }
  }
`;

interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string;
}

export function useWorkspacePresence(workspaceId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.workspacePresence(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        workspacePresence: PresenceEntry[];
      }>(WORKSPACE_PRESENCE_QUERY, { workspaceId: workspaceId! });
      return res.workspacePresence;
    },
  });

  useEffect(() => {
    if (query.data) {
      usePresenceStore
        .getState()
        .setBulk(query.data.map((e) => ({ userId: e.userId, status: e.status })));
    }
  }, [query.data]);

  return query;
}
