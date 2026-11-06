import { useShellStore } from "../../shell/state/useShellStore";
import { useWorkspaceStore } from "../workspaces/state/useWorkspaceStore";

/** Opens a workspace with no conversation selected, leaving Home for the conversation view. */
export function openWorkspace(workspaceId: string): void {
  const workspaces = useWorkspaceStore.getState();
  if (workspaces.workspaceId !== workspaceId) workspaces.setWorkspaceId(workspaceId);
  useShellStore.getState().setMainSurface({ kind: "conversation" });
}
