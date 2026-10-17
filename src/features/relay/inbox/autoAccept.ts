/**
 * A pending DM request from a fellow member of a workspace is accepted without asking when that
 * workspace lets them through: the person's choice for it (else the workspace's default) is
 * `DIRECT`, or the sender is its Owner or a Moderator. Membership and roles are read from the
 * member lists the workspaces' hosts answer (this relay for its own workspaces, the forward
 * path for others), never from the request. A workspace the person's settings do not list,
 * one on another server, counts as `DIRECT`.
 */

import {
  DmMembers,
  DmRequestStatus,
  type ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { fetchMyDmSettings } from "../../dm-policy/api/dmPolicy";
import { fetchServerMembers } from "../../workspaces/api/useServerMembers";
import { canModerate } from "../../workspaces/role";
import { acceptDmRequest, fetchDmRequests, type DmRequestView } from "../api/relayApi";
import { useRelayStore } from "../state/useRelayStore";

const MEMBERS_STALE_MS = 60_000;
const SETTINGS_STALE_MS = 60_000;

/** One workspace's members, as its host answered them. */
export interface WorkspaceMembers {
  workspaceId: string;
  members: readonly { principalId?: string | null; memberRole?: ServerMemberRoleGql }[];
}

/** The workspaces (not direct spaces) this person is in, here and on other hosts. */
async function workspaceIds(): Promise<string[]> {
  const { info, spaces } = useRelayStore.getState();
  const local =
    queryClient.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id) ?? [];
  const remote = Object.values(spaces)
    .filter((s) => s.kind === "workspace")
    .map((s) => s.spaceId);
  return [...local, ...remote].filter((id) => id !== info?.directSpaceId);
}

/**
 * Whether a DM from `principalId` reaches this person without a request: they share a
 * workspace of `lists` whose setting in `members` (absent counts as `DIRECT`) is `DIRECT`, or
 * where they are Owner or Moderator.
 */
export function admittedByWorkspace(
  principalId: string,
  lists: readonly WorkspaceMembers[],
  members: ReadonlyMap<string, DmMembers>,
): boolean {
  return lists.some(({ workspaceId, members: list }) => {
    const member = list.find((m) => m.principalId === principalId);
    if (!member) return false;
    if (canModerate(member.memberRole)) return true;
    return (members.get(workspaceId) ?? DmMembers.DIRECT) === DmMembers.DIRECT;
  });
}

async function memberLists(): Promise<WorkspaceMembers[]> {
  const ids = await workspaceIds();
  return Promise.all(
    ids.map(async (workspaceId) => ({
      workspaceId,
      members: await queryClient
        .fetchQuery({
          queryKey: queryKeys.serverMembers(workspaceId),
          queryFn: () => fetchServerMembers(workspaceId),
          staleTime: MEMBERS_STALE_MS,
        })
        .catch(() => []),
    })),
  );
}

/** This person's choice for each workspace; empty for a server without DM settings. */
async function memberSettings(): Promise<Map<string, DmMembers>> {
  const settings = await queryClient
    .fetchQuery({
      queryKey: queryKeys.myDmSettings,
      queryFn: fetchMyDmSettings,
      staleTime: SETTINGS_STALE_MS,
    })
    .catch(() => null);
  return new Map((settings?.workspaces ?? []).map((w) => [w.workspaceId, w.members]));
}

/** Accept every pending request its workspace lets through. Returns the requests accepted. */
export async function acceptWorkspaceMembers(pending?: DmRequestView[]): Promise<DmRequestView[]> {
  const requests = pending ?? (await fetchDmRequests(DmRequestStatus.PENDING));
  if (requests.length === 0) return [];
  const [lists, settings] = await Promise.all([memberLists(), memberSettings()]);
  const accepted: DmRequestView[] = [];
  for (const request of requests) {
    if (request.status !== DmRequestStatus.PENDING) continue;
    if (!admittedByWorkspace(request.fromPrincipalId, lists, settings)) continue;
    try {
      await acceptDmRequest(request.id);
      accepted.push(request);
    } catch (err) {
      logger.warn("[RIM:relay] accepting a workspace member's request failed:", err);
    }
  }
  if (accepted.length > 0) {
    await queryClient.invalidateQueries({ queryKey: ["dmRequests"] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.relayContacts });
  }
  return accepted;
}
