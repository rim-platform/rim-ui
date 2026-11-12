import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { asSentence, graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { refreshAfterBlockChange } from "../blocking/blockPerson";
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

/** Someone this account blocked, and the name the app shows for them. */
export interface UnblockTarget {
  principalId: string;
  name: string;
}

/**
 * Lifts a block at once, refreshes the blocked list and the conversation lists, and says how it
 * went in a toast. Settings and the Unblock command both run it.
 *
 * @returns Whether the block was lifted.
 */
export async function unblockPerson(
  qc: QueryClient,
  { principalId, name }: UnblockTarget,
): Promise<boolean> {
  try {
    await unblockPrincipal(principalId);
  } catch (err) {
    toast.error(graphqlErrorMessage(err, `Could not unblock ${name}`));
    return false;
  }
  await qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals });
  await refreshAfterBlockChange(qc);
  toast.success(asSentence(`Unblocked ${name}`), {
    description:
      "They can message you again. A conversation they started comes back as a request when they next write in it.",
  });
  return true;
}

/** {@link unblockPerson} with its pending state, for a control that shows it. */
export function useUnblockPrincipal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: UnblockTarget) => unblockPerson(qc, target),
  });
}
