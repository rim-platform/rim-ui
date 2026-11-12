import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { AgentSession, AgentSessionStatus } from "../../acp/agentSession";

/**
 * Every session's status, kept current: re-renders whenever one changes.
 *
 * @returns Each key's status.
 */
export function useStatuses(
  sessions: Record<string, AgentSession>,
): Record<string, AgentSessionStatus> {
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = Object.values(sessions).map((session) => session.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    [sessions],
  );
  const read = useCallback(
    () =>
      Object.entries(sessions)
        .map(([key, session]) => `${key}=${session.status}`)
        .join("\n"),
    [sessions],
  );
  const joined = useSyncExternalStore(subscribe, read);
  return useMemo(() => {
    const statuses: Record<string, AgentSessionStatus> = {};
    for (const line of joined === "" ? [] : joined.split("\n")) {
      const at = line.indexOf("=");
      statuses[line.slice(0, at)] = line.slice(at + 1) as AgentSessionStatus;
    }
    return statuses;
  }, [joined]);
}
