import { useEffect, useState } from "react";

import { useAuthStore } from "../../auth/state/useAuthStore";
import { useServerMembers } from "../api/useServerMembers";
import { useTimeoutStore } from "../state/useTimeoutStore";

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * The end of the viewer's own timeout in `workspaceId` while it is in force, else `null`.
 *
 * Two sources: the viewer's `timeoutUntil` in the member directory, and the `until` of the
 * last `TIMED_OUT` error. A member list fetched after that error is the fresher truth (it
 * reflects a moderator clearing the timeout); otherwise the later of the two wins. The hook
 * re-renders when the timeout runs out.
 */
export function useMyTimeout(workspaceId: string | null | undefined): string | null {
  const ws = workspaceId ?? undefined;
  const userId = useAuthStore((s) => s.session?.userId);
  const { data: members, dataUpdatedAt } = useServerMembers(ws);
  const noted = useTimeoutStore((s) => (ws ? s.byWorkspace[ws] : undefined));
  const [now, setNow] = useState(() => Date.now());

  const own = members?.find((m) => m.userId === userId)?.timeoutUntil ?? null;
  const until = noted && noted.recordedAt >= dataUpdatedAt ? later(own, noted.until) : own;
  const active = until && Date.parse(until) > now ? until : null;

  useEffect(() => {
    if (!active) return;
    // setTimeout caps at ~24.8 days; re-arming on the next render covers longer timeouts.
    const delay = Math.min(Math.max(Date.parse(active) - Date.now(), 0) + 50, 2_147_000_000);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [active, now]);

  return active;
}
