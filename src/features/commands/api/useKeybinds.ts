import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { ResolvedKeybind } from "../types";

const ResolvedKeybindsDocument = gql`
  query ResolvedKeybinds($workspaceId: ID) {
    resolvedKeybinds(workspaceId: $workspaceId) {
      id
      keystroke
      commandId
      context
      source
      scope
      isEnabled
      presetArgs
    }
  }
`;

export function useResolvedKeybinds(workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.resolvedKeybinds(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ resolvedKeybinds: ResolvedKeybind[] }>(
        ResolvedKeybindsDocument,
        { workspaceId }
      );
      return res.resolvedKeybinds;
    },
  });
}
