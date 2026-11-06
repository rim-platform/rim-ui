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
 * The workspace of a request, or `null` for one from outside every workspace; read from the
 * caches only, as the workspace rail keeps the lists fresh.
 */
function useRequestScope(): (request: DmRequestView) => string | null {
  const info = useRelayStore((s) => s.info);
  const spaces = useRelayStore((s) => s.spaces);
  const { data: servers } = useMyServers(false);
  return useMemo(() => {
    const localWorkspaceIds = new Set(
      (servers ?? []).map((s) => s.id).filter((id) => id !== info?.directSpaceId),
    );
    const known = { ownServerId: info?.serverId ?? null, localWorkspaceIds, spaces };
    return (request) => requestWorkspaceId(request, known);
  }, [info, spaces, servers]);
}

/**
 * The pending requests of one scope: those whose conversation belongs to the workspace
 * `scope`, or with `null`, those from outside every workspace. `undefined` keeps them all.
 */
export function usePendingDmRequestsIn(scope: string | null | undefined): DmRequestView[] {
  const requests = usePendingDmRequests().data ?? NO_REQUESTS;
  const scopeOf = useRequestScope();
  return useMemo(() => {
    if (scope === undefined) return requests;
    return requests.filter((request) => scopeOf(request) === scope);
  }, [requests, scope, scopeOf]);
}

/** How many pending requests each scope has: a workspace id, or `null` for outside every one. */
export function usePendingDmRequestCounts(): ReadonlyMap<string | null, number> {
  const requests = usePendingDmRequests().data ?? NO_REQUESTS;
  const scopeOf = useRequestScope();
  return useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const request of requests) {
      const scope = scopeOf(request);
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }
    return counts;
  }, [requests, scopeOf]);
}
