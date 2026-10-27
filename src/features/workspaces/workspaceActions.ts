import type { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import { queryKeys } from "../../core/query/keys";
import { queryClient } from "../../core/query/queryClient";
import { toast } from "../../shared/toast";
import { isDirectSpace } from "../relay/state/useRelayStore";
import type { KnownServerInfo } from "../updater/api/serverInfoApi";
import { WORKSPACE_LEAVE, WORKSPACE_RENAME } from "../updater/api/serverCapabilities";
import type { ServerDetail } from "./api/useWorkspace";
import { isOwner } from "./role";
import { useWorkspaceActionStore, type WorkspaceAction } from "./state/useWorkspaceActionStore";
import { useWorkspaceStore } from "./state/useWorkspaceStore";

export type { WorkspaceAction };

/** What decides whether the viewer may leave or rename a workspace. */
export interface WorkspaceActionFacts {
  /** The viewer's role there; undefined while it loads. */
  role: ServerMemberRoleGql | null | undefined;
  inDirectSpace: boolean;
  /** Whether it is the connected server's default workspace. */
  isDefault: boolean;
  /** The connected server's `serverInfo.capabilities`; undefined for an older server. */
  capabilities: readonly string[] | undefined;
}

/**
 * Anyone but the Owner, outside the direct space and the default workspace, on a server with
 * `workspace_leave`.
 */
export function canLeaveWorkspace(facts: WorkspaceActionFacts): boolean {
  return (
    Boolean(facts.capabilities?.includes(WORKSPACE_LEAVE)) &&
    !facts.inDirectSpace &&
    !facts.isDefault &&
    facts.role != null &&
    !isOwner(facts.role)
  );
}

/** The Owner, outside the direct space, on a server with `workspace_rename`. */
export function canRenameWorkspace(facts: WorkspaceActionFacts): boolean {
  return (
    Boolean(facts.capabilities?.includes(WORKSPACE_RENAME)) &&
    !facts.inDirectSpace &&
    isOwner(facts.role)
  );
}

/**
 * {@link canLeaveWorkspace} or {@link canRenameWorkspace} for `workspaceId`, read from the
 * cached role and server info.
 */
export function workspaceActionOffered(
  action: WorkspaceAction,
  workspaceId: string | null,
): boolean {
  if (!workspaceId) return false;
  const info = queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo);
  const facts: WorkspaceActionFacts = {
    role: queryClient.getQueryData<ServerDetail>(queryKeys.server(workspaceId))?.viewerRole,
    inDirectSpace: isDirectSpace(workspaceId),
    isDefault: info?.defaultWorkspace === workspaceId,
    capabilities: info?.capabilities,
  };
  return action === "leave" ? canLeaveWorkspace(facts) : canRenameWorkspace(facts);
}

/**
 * Whether the palette offers `commandId` now: `workspace.leave` and `workspace.rename` for the
 * open workspace when allowed, every other command always.
 */
export function workspaceCommandOffered(commandId: string): boolean {
  if (commandId !== "workspace.leave" && commandId !== "workspace.rename") return true;
  const action = commandId === "workspace.leave" ? "leave" : "rename";
  return workspaceActionOffered(action, useWorkspaceStore.getState().workspaceId);
}

/** Opens `action`'s dialog for the open workspace, or says why it cannot. */
export function openWorkspaceAction(action: WorkspaceAction): void {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (workspaceId && workspaceActionOffered(action, workspaceId)) {
    useWorkspaceActionStore.getState().open(action, workspaceId);
    return;
  }
  toast.info(
    action === "leave"
      ? "You cannot leave this workspace."
      : "Only the owner can rename this workspace.",
  );
}
