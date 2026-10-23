import type { QueryClient } from "@tanstack/react-query";

import type { RemovalNotice } from "./useRemovalNotices";
import { removalAccountKey, removalMessage, useRemovalNotices } from "./useRemovalNotices";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMembersPanelStore } from "../../conversations/state/useMembersPanelStore";
import { parseEventRole } from "../role";
import { useMemberDirectoryStore } from "./useMemberDirectoryStore";
import { useWorkspaceStore } from "./useWorkspaceStore";

/**
 * Realtime handlers for workspace membership events, called from `useWorkspaceEvents`.
 */

function currentUserId(qc: QueryClient): string | undefined {
  return (
    useAuthStore.getState().session?.userId ?? qc.getQueryData<{ id: string }>(queryKeys.me)?.id
  );
}

interface CachedServer {
  id: string;
  name?: string;
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

/** Workspaces this client is deleting: the `MemberLeft` the deletion sends needs no toast. */
const departing = new Set<string>();

/** Marks a workspace this client is about to delete. */
export function expectDeparture(workspaceId: string): void {
  departing.add(workspaceId);
}

/** Unmarks a workspace whose deletion failed. */
export function forgetDeparture(workspaceId: string): void {
  departing.delete(workspaceId);
}

/**
 * Drops a workspace the viewer is no longer in: removes it from `myServers` and, when it is
 * open, clears the selection (the workspace selector then opens the next workspace, or the
 * empty state). Safe to call again for the same workspace.
 */
export function leaveWorkspace(qc: QueryClient, workspaceId: string): void {
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
}

/**
 * A member was kicked or banned, or the workspace was deleted. For anyone else, refetch the
 * member directory. For the viewer, leave the workspace and say why with a toast, unless this
 * client is deleting it.
 */
export function handleMemberLeft(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
  details?: { cause?: string | null; until?: string | null; reason?: string | null },
): void {
  if (userId !== currentUserId(qc)) {
    qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
    return;
  }

  const name = qc
    .getQueryData<CachedServer[]>(queryKeys.myServers())
    ?.find((s) => s.id === workspaceId)?.name;
  leaveWorkspace(qc, workspaceId);
  if (departing.delete(workspaceId)) return;
  if (details?.cause === "ban" || details?.cause === "kick") {
    const notice: RemovalNotice = {
      workspaceId,
      workspaceName: name,
      cause: details.cause,
      until: details.until,
      reason: details.reason,
    };
    useRemovalNotices.getState().add(removalAccountKey(userId), notice);
    toast.info(removalMessage(notice));
    return;
  }
  toast.info(name ? `You were removed from ${name}` : "You were removed from this workspace");
}

/** Refresh message authors in every cached view of a workspace. */
function invalidateAuthors(qc: QueryClient, workspaceId: string): void {
  const roots = new Set([
    "messages",
    "threadMessages",
    "searchMessages",
    "pinnedMessages",
    "lensMessages",
  ]);
  void qc.invalidateQueries({
    predicate: (query) => roots.has(String(query.queryKey[0])) && query.queryKey[1] === workspaceId,
  });
}

/** Refresh every view that embeds workspace author ban status. */
export function handleMemberBanChanged(qc: QueryClient, workspaceId: string): void {
  invalidateAuthors(qc, workspaceId);
  void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
  void qc.invalidateQueries({ queryKey: queryKeys.serverBans(workspaceId) });
}

/** Refresh member pictures, embedded message authors and this account's other sessions. */
export function handleMemberProfileUpdated(
  qc: QueryClient,
  workspaceId: string,
  userId: string,
): void {
  invalidateAuthors(qc, workspaceId);
  void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
  if (userId === currentUserId(qc)) void qc.invalidateQueries({ queryKey: queryKeys.me });
}
