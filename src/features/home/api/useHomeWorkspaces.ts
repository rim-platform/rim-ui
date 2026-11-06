import { useMemo } from "react";

import { useDirectSpaceIds } from "../../relay/api/useDirectInbox";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { ownerName, workspaceLabels } from "../../workspaces/workspaceLabel";

/** A workspace Home covers. */
export interface HomeWorkspace {
  id: string;
  /** The name, with the owner or host added where two workspaces share it. */
  label: string;
  /** Whether this server hosts it; a workspace on another server is asked for at its host. */
  local: boolean;
}

/** The workspaces of this account that Home covers, as the workspace rail lists them. */
export function useHomeWorkspaces(): { workspaces: HomeWorkspace[]; isPending: boolean } {
  const { data: servers, isPending } = useMyServers();
  const directSpaceIds = useDirectSpaceIds();
  const remoteSpaces = useRelayStore((s) => s.spaces);
  const origins = useRelayStore((s) => s.origins);
  const forked = useRelayStore((s) => s.forked);
  const workspaces = useMemo(() => {
    const local = (servers ?? [])
      .filter((server) => !directSpaceIds.includes(server.id))
      .map((server) => ({
        id: server.id,
        name: server.name,
        ownerName: ownerName(server.owner),
        origin: null as string | null,
        local: true,
      }));
    const elsewhere = Object.values(remoteSpaces)
      .filter((space) => space.kind === "workspace" && !forked.includes(space.hostServerId))
      .map((space) => ({
        id: space.spaceId,
        name: space.name ?? "Workspace",
        ownerName: space.ownerName,
        origin: origins[space.hostServerId] ?? space.hostServerId,
        local: false,
      }));
    const all = [...local, ...elsewhere];
    const labels = workspaceLabels(all);
    return all.map((workspace, index) => ({
      id: workspace.id,
      label: labels[index],
      local: workspace.local,
    }));
  }, [servers, directSpaceIds, remoteSpaces, origins, forked]);
  return { workspaces, isPending };
}
