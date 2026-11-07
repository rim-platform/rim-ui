import { useRelayStore } from "../../relay/state/useRelayStore";
import { useMyServers } from "../api/useMyServers";

/**
 * A workspace's name: from the workspace list, or the stored space of a workspace on another
 * server; `null` while it is not known.
 *
 * @param workspaceId - The workspace, or `null` for none.
 */
export function useWorkspaceName(workspaceId: string | null): string | null {
  const { data: servers } = useMyServers();
  const remote = useRelayStore((s) => (workspaceId ? s.spaces[workspaceId]?.name : undefined));
  if (!workspaceId) return null;
  return servers?.find((server) => server.id === workspaceId)?.name ?? remote ?? null;
}
