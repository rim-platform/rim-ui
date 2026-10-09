/**
 * Members and their devices as the encryption code needs them: who a conversation's members
 * are by principal id, whether each is ready, and the key logs and device lists leaves are
 * checked against.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { fetchKeyLog } from "../../key-identity/api/keyIdentity";
import { fetchServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { fetchPrincipalDevices, type DirectoryPrincipal } from "../api/e2eeApi";
import type { DirectoryInput } from "../api/e2eeCommands";

export function workspaceMembers(workspaceId: string): Promise<ServerMember[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.serverMembers(workspaceId),
    queryFn: () => fetchServerMembers(workspaceId),
    staleTime: 60_000,
  });
}

/** The members of a conversation (user ids), with their principal ids where they have one. */
export async function conversationMembers(
  workspaceId: string,
  memberIds: string[],
): Promise<ServerMember[]> {
  const members = await workspaceMembers(workspaceId);
  const ids = new Set(memberIds);
  return members.filter((m) => ids.has(m.userId));
}

/** Whether a principal has a device set up for encryption: not revoked, key packages recent. */
export function isReady(principal: DirectoryPrincipal | undefined): boolean {
  return Boolean(principal?.devices.some((d) => d.mlsActive && !d.revokedAt));
}

/**
 * The members who are not ready, by display name. A member without a principal (a
 * password-only account, a bot) is never ready.
 */
export async function notReadyMembers(
  members: ServerMember[],
): Promise<{ names: string[]; directory: DirectoryPrincipal[] }> {
  const principalIds = members.flatMap((m) => (m.principalId ? [m.principalId] : []));
  const directory = principalIds.length ? await fetchPrincipalDevices(principalIds) : [];
  const byId = new Map(directory.map((p) => [p.principalId, p]));
  const names = members
    .filter((m) => !m.principalId || !isReady(byId.get(m.principalId)))
    .map((m) => m.displayName || m.username);
  return { names, directory };
}

/** Key logs and device lists of `principalIds`, for checking leaves. */
export async function directoryFor(
  members: string[],
  principalIds: string[],
): Promise<DirectoryInput> {
  const unique = [...new Set(principalIds)];
  if (unique.length === 0) return { members, principals: [] };
  const [devices, logs] = await Promise.all([
    fetchPrincipalDevices(unique),
    Promise.all(unique.map((id) => fetchKeyLog(id).catch(() => []))),
  ]);
  const byId = new Map(devices.map((p) => [p.principalId, p.devices]));
  return {
    members,
    principals: unique.map((principalId, i) => ({
      principalId,
      keyLog: logs[i],
      devices: byId.get(principalId) ?? [],
    })),
  };
}
