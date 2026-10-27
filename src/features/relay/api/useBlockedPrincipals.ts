import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isSchemaRefusal } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";
import { fetchBlockedPrincipals, unblockPrincipal } from "./relayApi";

/** The blocked list's query: a minute fresh, never retried once the server refused it as unknown. */
export const blockedPrincipalsQuery = queryOptions({
  queryKey: queryKeys.myBlockedPrincipals,
  staleTime: 60_000,
  retry: (failures, err) => !isSchemaRefusal(err) && failures < 2,
  queryFn: fetchBlockedPrincipals,
});

/** The people this account blocked, newest first, kept by the relay. Off while the relay is. */
export function useBlockedPrincipals() {
  const relayOn = useRelayStore((s) => s.info !== null);
  return useQuery({ ...blockedPrincipalsQuery, enabled: relayOn });
}

/** Lifts a block at once; the list of blocked people refreshes after it. */
export function useUnblockPrincipal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (principalId: string) => unblockPrincipal(principalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals }),
  });
}
