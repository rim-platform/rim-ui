import { useServerInfo } from "../../updater/hooks/useServerInfo";

/**
 * Whether `workspaceId` is the server's default workspace, which every account joins; false
 * while the server's info loads or when there is none.
 */
export function useIsDefaultWorkspace(workspaceId: string | null | undefined): boolean {
  const { info } = useServerInfo();
  return Boolean(workspaceId) && info?.defaultWorkspace === workspaceId;
}
