import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
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

/**
 * The viewer's keybinds with the workspace's layer resolved in. A direct space has no layer, so
 * there the viewer's own keybinds are asked for without a workspace.
 */
export function useResolvedKeybinds(spaceId?: string) {
  const workspaceId = useIsDirectSpace(spaceId) ? undefined : spaceId;
  return useQuery({
    queryKey: queryKeys.resolvedKeybinds(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ resolvedKeybinds: ResolvedKeybind[] }>(
        ResolvedKeybindsDocument,
        { workspaceId },
      );
      return res.resolvedKeybinds;
    },
  });
}
