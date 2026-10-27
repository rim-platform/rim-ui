import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";
import { fetchBlockedPrincipals, unblockPrincipal } from "./relayApi";

/** The people this account blocked, newest first, kept by the relay. Off while the relay is. */
export function useBlockedPrincipals() {
  const relayOn = useRelayStore((s) => s.info !== null);
  return useQuery({
    queryKey: queryKeys.myBlockedPrincipals,
    enabled: relayOn,
    staleTime: 60_000,
    queryFn: fetchBlockedPrincipals,
  });
}

/** Lifts a block at once; the list of blocked people refreshes after it. */
export function useUnblockPrincipal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (principalId: string) => unblockPrincipal(principalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals }),
  });
}
