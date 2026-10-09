/**
 * Workspace members are never strangers: a pending DM request from someone who shares a
 * workspace with this person is accepted without asking. Membership is read from the member
 * lists the workspaces' hosts answer (this relay for its own workspaces, the forward path for
 * others), never from the request.
 */

import { DmRequestStatus } from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { fetchServerMembers } from "../../workspaces/api/useServerMembers";
import { acceptDmRequest, fetchDmRequests, type DmRequestView } from "../api/relayApi";
import { useRelayStore } from "../state/useRelayStore";

const MEMBERS_STALE_MS = 60_000;

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

/** Whether `principalId` is a member of one of the workspaces in `memberLists`. */
export function sharesWorkspace(
  principalId: string,
  memberLists: readonly { principalId?: string | null }[][],
): boolean {
  return memberLists.some((members) => members.some((m) => m.principalId === principalId));
}

async function memberLists(): Promise<{ principalId?: string | null }[][]> {
  const ids = await workspaceIds();
  const lists = await Promise.all(
    ids.map((serverId) =>
      queryClient
        .fetchQuery({
          queryKey: queryKeys.serverMembers(serverId),
          queryFn: () => fetchServerMembers(serverId),
          staleTime: MEMBERS_STALE_MS,
        })
        .catch(() => []),
    ),
  );
  return lists;
}

/** Accept every pending request from a workspace member. Returns the requests accepted. */
export async function acceptWorkspaceMembers(pending?: DmRequestView[]): Promise<DmRequestView[]> {
  const requests = pending ?? (await fetchDmRequests(DmRequestStatus.PENDING));
  if (requests.length === 0) return [];
  const lists = await memberLists();
  const accepted: DmRequestView[] = [];
  for (const request of requests) {
    if (request.status !== DmRequestStatus.PENDING) continue;
    if (!sharesWorkspace(request.fromPrincipalId, lists)) continue;
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
