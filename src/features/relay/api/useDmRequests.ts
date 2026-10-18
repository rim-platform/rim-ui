import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { DmRequestStatus } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { requestWorkspaceId } from "../inbox/requestWorkspace";
import { useRelayStore } from "../state/useRelayStore";
import { fetchDmRequests, type DmRequestView } from "./relayApi";

const NO_REQUESTS: DmRequestView[] = [];

/** Pending message requests; empty while the relay is off. */
export function usePendingDmRequests() {
  const relayOn = useRelayStore((s) => s.info !== null);
  return useQuery({
    queryKey: queryKeys.dmRequests(DmRequestStatus.PENDING),
    enabled: relayOn,
    staleTime: 30_000,
    queryFn: () => fetchDmRequests(DmRequestStatus.PENDING),
  });
}

/** How many message requests wait for a decision. */
export function usePendingDmRequestCount(): number {
  return usePendingDmRequests().data?.length ?? 0;
}

/**
 * The pending requests of one scope: those whose conversation belongs to the workspace
 * `scope`, or with `null`, those from outside every workspace. `undefined` keeps them all.
 */
export function usePendingDmRequestsIn(scope: string | null | undefined): DmRequestView[] {
  const requests = usePendingDmRequests().data ?? NO_REQUESTS;
  const info = useRelayStore((s) => s.info);
  const spaces = useRelayStore((s) => s.spaces);
  // Read from the cache only: the workspace rail keeps the list fresh.
  const { data: servers } = useMyServers(false);
  return useMemo(() => {
    if (scope === undefined) return requests;
    const localWorkspaceIds = new Set(
      (servers ?? []).map((s) => s.id).filter((id) => id !== info?.directSpaceId),
    );
    const known = { ownServerId: info?.serverId ?? null, localWorkspaceIds, spaces };
    return requests.filter((request) => requestWorkspaceId(request, known) === scope);
  }, [requests, scope, info, spaces, servers]);
}
