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
 * The viewer's keybinds with the workspace's layer resolved in, from the server that hosts the
 * workspace. A direct space has no layer, so there, and with no `spaceId`, the viewer's own
 * keybinds are asked of the connected server without a workspace.
 *
 * @param enabled - Whether to read them; `false` leaves the query idle.
 */
export function useResolvedKeybinds(spaceId?: string, enabled = true) {
  const workspaceId = useIsDirectSpace(spaceId) ? undefined : spaceId;
  return useQuery({
    queryKey: queryKeys.resolvedKeybinds(workspaceId),
    staleTime: 60_000,
    enabled,
    queryFn: async () => {
      const res = await graphqlClient.request<{ resolvedKeybinds: ResolvedKeybind[] }>(
        ResolvedKeybindsDocument,
        { workspaceId },
      );
      return res.resolvedKeybinds;
    },
  });
}
