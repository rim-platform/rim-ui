import { create } from "zustand";

import { timedOutUntil } from "../../../core/graphql/errors";

interface NotedTimeout {
  until: string;
  /** `Date.now()` when the `TIMED_OUT` error arrived, to compare with member-list freshness. */
  recordedAt: number;
}

type TimeoutState = {
  /** The viewer's timeout per workspace, as learned from a `TIMED_OUT` error. */
  byWorkspace: Record<string, NotedTimeout>;
  noteTimeout: (workspaceId: string, until: string) => void;
  clearTimeout: (workspaceId: string) => void;
};

export const useTimeoutStore = create<TimeoutState>((set) => ({
  byWorkspace: {},
  noteTimeout: (workspaceId, until) =>
    set((s) => ({
      byWorkspace: { ...s.byWorkspace, [workspaceId]: { until, recordedAt: Date.now() } },
    })),
  clearTimeout: (workspaceId) =>
    set((s) => {
      if (!(workspaceId in s.byWorkspace)) return s;
      const next = { ...s.byWorkspace };
      delete next[workspaceId];
      return { byWorkspace: next };
    }),
}));

/**
 * Records the viewer's timeout when `err` is a `TIMED_OUT` error, so the composer shows the
 * timed-out banner. Returns the `until` it recorded, else `undefined`.
 */
export function noteTimedOutError(
  workspaceId: string | null | undefined,
  err: unknown,
): string | undefined {
  const until = timedOutUntil(err);
  if (until && workspaceId) useTimeoutStore.getState().noteTimeout(workspaceId, until);
  return until;
}
