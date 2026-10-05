import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMembersPanelStore } from "../../conversations/state/useMembersPanelStore";
import { parseEventRole } from "../role";
import { useMemberDirectoryStore } from "./useMemberDirectoryStore";
import { useWorkspaceStore } from "./useWorkspaceStore";

/**
 * Realtime handlers for workspace membership events (Track 1.2), called from
 * `useWorkspaceEvents`.
 */

function currentUserId(qc: QueryClient): string | undefined {
  return (
    useAuthStore.getState().session?.userId ?? qc.getQueryData<{ id: string }>(queryKeys.me)?.id
  );
}

interface CachedServer {
  id: string;
}

interface CachedServerDetail {
  viewerRole: unknown;
}

/**
 * A member's role changed: refetch the member directory. For the viewer, patch and refetch
 * their own role (`Server.viewerRole`) so role-gated UI, the guest restrictions included,
 * re-evaluates at once, and refetch the lists whose contents depend on the role (a guest
 * sees only joined channels and fewer commands).
 */
export function handleMemberRoleChanged(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
  roleName: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
  if (userId !== currentUserId(qc)) return;

  const role = parseEventRole(roleName);
  if (role) {
    qc.setQueryData<CachedServerDetail>(queryKeys.server(workspaceId), (old) =>
      old ? { ...old, viewerRole: role } : old,
    );
  }
  qc.invalidateQueries({ queryKey: queryKeys.server(workspaceId) });
  qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
  qc.invalidateQueries({ queryKey: ["commands"] });
}

/**
 * A member was kicked or banned. For anyone else, refetch the member directory. For the
 * viewer, leave the workspace: drop it from `myServers`, clear the selection (the workspace
 * selector then opens the next workspace, or the empty state) and say why with a toast.
 */
export function handleMemberLeft(qc: QueryClient, workspaceId: string, userId: string): void {
  if (userId !== currentUserId(qc)) {
    qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
    return;
  }

  qc.setQueryData<CachedServer[]>(queryKeys.myServers(), (old) =>
    old?.filter((server) => server.id !== workspaceId),
  );
  if (useWorkspaceStore.getState().workspaceId === workspaceId) {
    useMembersPanelStore.getState().setOpen(false);
    useMemberDirectoryStore.getState().setOpen(false);
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useShellStore.getState().setSelectedConversationId(null);
    useWorkspaceStore.getState().clearWorkspaceId();
  }
  qc.invalidateQueries({ queryKey: queryKeys.myServers() });
  toast.info("You were removed from this workspace");
}
