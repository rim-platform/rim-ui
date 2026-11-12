import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";

function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The workspace an app command acts in: the one its `server_id` argument names, else its
 * context's workspace, else the open one. A control of another workspace, such as that
 * workspace's menu on the rail, names it so the command does not act on the open one.
 *
 * @returns The workspace's id, or `null` when none is named and none is open.
 */
export function targetWorkspaceOf(
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
): string | null {
  return (
    nonBlank(args?.server_id) ??
    nonBlank(args?.serverId) ??
    nonBlank(commandContext?.workspaceId) ??
    useWorkspaceStore.getState().workspaceId
  );
}

/** Opens `workspaceId` when another workspace is open, so a page of it can show. */
export function showWorkspace(workspaceId: string): void {
  const workspaces = useWorkspaceStore.getState();
  if (workspaces.workspaceId !== workspaceId) workspaces.setWorkspaceId(workspaceId);
}
