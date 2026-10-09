import { useQuery } from "@tanstack/react-query";

import { DmRequestStatus } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";
import { fetchDmRequests } from "./relayApi";

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
