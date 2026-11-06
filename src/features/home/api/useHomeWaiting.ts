import { useQueries } from "@tanstack/react-query";

import { usePendingDmRequestCounts } from "../../relay/api/useDmRequests";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import {
  joinRequestBadge,
  joinRequestCountQueryOptions,
} from "../../workspaces/api/publicJoinLink";
import { workspaceQueryOptions } from "../../workspaces/api/useWorkspace";
import { canModerate } from "../../workspaces/role";
import type { HomeWorkspace } from "./useHomeWorkspaces";

/** A thing that waits for a decision from the person. */
export type WaitingRow =
  | {
      kind: "dm-requests";
      /** The workspace the requests came through, or null for those from outside every one. */
      workspaceId: string | null;
      label: string;
      count: number;
    }
  | {
      kind: "join-requests";
      workspaceId: string;
      label: string;
      /** The count as the badges show it, with `+` when there are more. */
      badge: string;
    };

/** What the message-request row names when the requests came from outside every workspace. */
export const OUTSIDE_WORKSPACES_LABEL = "People outside your workspaces";

/**
 * What waits for the person's decision in the given workspaces: message requests, and join
 * requests where the person moderates and the workspace can have a public link, which is the
 * condition the Settings badge uses. Workspaces on other servers have no join requests here.
 *
 * @param workspaces - The workspaces to look at.
 * @param only - The one to restrict to, or null for all. Requests from outside every workspace
 * show only for null.
 */
export function useHomeWaiting(workspaces: readonly HomeWorkspace[], only: string | null) {
  const requestCounts = usePendingDmRequestCounts();
  const { info } = useServerInfo();
  const local = workspaces.filter((w) => w.local && (only === null || w.id === only));
  const roles = useQueries({ queries: local.map((w) => workspaceQueryOptions(w.id)) });
  const eligible = local.map(
    (w, index) =>
      canModerate(roles[index]?.data?.viewerRole) &&
      info !== undefined &&
      info.defaultWorkspace !== w.id,
  );
  const counts = useQueries({
    queries: local.map((w, index) => joinRequestCountQueryOptions(w.id, eligible[index])),
  });

  const rows: WaitingRow[] = [];
  for (const workspace of only === null ? workspaces : local) {
    const count = requestCounts.get(workspace.id) ?? 0;
    if (count > 0) {
      rows.push({ kind: "dm-requests", workspaceId: workspace.id, label: workspace.label, count });
    }
  }
  const outside = requestCounts.get(null) ?? 0;
  if (only === null && outside > 0) {
    rows.push({
      kind: "dm-requests",
      workspaceId: null,
      label: OUTSIDE_WORKSPACES_LABEL,
      count: outside,
    });
  }
  local.forEach((workspace, index) => {
    const badge = eligible[index] ? joinRequestBadge(counts[index]?.data) : null;
    if (badge) {
      rows.push({
        kind: "join-requests",
        workspaceId: workspace.id,
        label: workspace.label,
        badge,
      });
    }
  });
  return rows;
}
