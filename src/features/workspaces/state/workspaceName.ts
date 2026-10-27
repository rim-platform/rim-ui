import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { setSpaceDetails } from "../../relay/state/spaces";
import { hostOf } from "../../relay/state/useRelayStore";

/**
 * Shows `name` as `workspaceId`'s name wherever the app keeps it: the rail's workspace list,
 * the workspace query and, for a workspace on another server, its stored space.
 */
export function applyWorkspaceName(qc: QueryClient, workspaceId: string, name: string): void {
  qc.setQueryData<{ id: string; name: string }[]>(queryKeys.myServers(), (old) =>
    old?.map((server) => (server.id === workspaceId ? { ...server, name } : server)),
  );
  qc.setQueryData<{ name: string } | undefined>(queryKeys.server(workspaceId), (old) =>
    old ? { ...old, name } : old,
  );
  if (hostOf(workspaceId)) void setSpaceDetails(workspaceId, { name });
}
