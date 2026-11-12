import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";

/** Refreshes a conversation's timeline once a reaction in it changed. */
export function invalidateAfterReaction(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.messages(serverId, conversationId) });
}
