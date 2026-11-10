import { useCallback, useSyncExternalStore } from "react";

import type { AgentSession, AgentSessionSnapshot } from "../../acp/agentSession";

/**
 * The session's snapshot, kept current.
 *
 * @param session - The session, or `undefined`.
 * @returns Its snapshot, or `null` without a session.
 */
export function useSessionSnapshot(session: AgentSession | undefined): AgentSessionSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : () => false),
    [session],
  );
  const read = useCallback(() => session?.getSnapshot() ?? null, [session]);
  return useSyncExternalStore(subscribe, read);
}
