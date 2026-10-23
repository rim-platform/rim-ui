import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceEvent } from "../../../core/events/types";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { detectPlatform } from "../../../core/runtime/runtime";
import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { showDesktopNotification } from "../../notifications/runtime/desktopNotification";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import type { Server } from "../../workspaces/api/useMyServers";
import {
  invalidateJoinRequests,
  type JoinRequestRow,
  type PublicJoinLinkPreviewData,
} from "../api/publicLink";

/**
 * Realtime handlers for join requests, called from `useWorkspaceEvents` with the event as it
 * arrived. Moderators hear them on the workspace's subscription and the person on their
 * direct-space subscription, so they act on the event's `workspace_id`, never on the
 * subscription's space.
 */

type JoinRequestCreatedEvent = Extract<WorkspaceEvent, { type: "JoinRequestCreated" }>;
type JoinRequestDecidedEvent = Extract<WorkspaceEvent, { type: "JoinRequestDecided" }>;

function currentUserId(qc: QueryClient): string | undefined {
  return (
    useAuthStore.getState().session?.userId ?? qc.getQueryData<{ id: string }>(queryKeys.me)?.id
  );
}

/** Refreshes the viewer's own requests and every open link page. */
function refreshOwnRequests(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.myJoinRequests });
  void qc.invalidateQueries({ queryKey: ["publicJoinLinkPreview"] });
}

/**
 * The name of the workspace `workspaceId` as the caches know it: from the viewer's own requests,
 * a link page they opened, or their workspaces.
 */
function cachedWorkspaceName(qc: QueryClient, workspaceId: string): string | null {
  const request = qc
    .getQueryData<JoinRequestRow[]>(queryKeys.myJoinRequests)
    ?.find((r) => r.serverId === workspaceId);
  if (request) return request.workspaceName;
  for (const [, preview] of qc.getQueriesData<PublicJoinLinkPreviewData>({
    queryKey: ["publicJoinLinkPreview"],
  })) {
    if (preview?.serverId === workspaceId) return preview.name;
  }
  return (
    qc.getQueryData<Server[]>(queryKeys.myServers())?.find((s) => s.id === workspaceId)?.name ??
    null
  );
}

/** A person asked to join: the moderators' lists and badges, or the person's own requests. */
export function handleJoinRequestCreated(qc: QueryClient, event: JoinRequestCreatedEvent): void {
  invalidateJoinRequests(qc, event.workspace_id);
  if (event.user_id === currentUserId(qc)) refreshOwnRequests(qc);
}

/**
 * A join request was closed. Moderators' lists and badges refresh. For the person it was about,
 * their requests and link pages refresh; an acceptance also refreshes their workspaces, so the
 * workspace appears, and an acceptance or a decline notifies them. A withdrawn or cancelled
 * request notifies nobody.
 */
export async function handleJoinRequestDecided(
  qc: QueryClient,
  event: JoinRequestDecidedEvent,
): Promise<void> {
  invalidateJoinRequests(qc, event.workspace_id);
  if (event.user_id !== currentUserId(qc)) return;
  const name = cachedWorkspaceName(qc, event.workspace_id);
  refreshOwnRequests(qc);
  if (event.outcome === "accepted") {
    await qc.invalidateQueries({ queryKey: queryKeys.myServers() });
    await notifyJoinRequestDecided(name ?? cachedWorkspaceName(qc, event.workspace_id), true);
  } else if (event.outcome === "declined") {
    await notifyJoinRequestDecided(name, false);
  }
}

/**
 * Tells the person their request to join `workspaceName` was accepted or declined, as the
 * device's notification settings allow: a desktop notification in the desktop app, an in-app
 * toast elsewhere, nothing while notifications are off.
 *
 * @param workspaceName The workspace, or null when its name is not known here.
 * @param accepted Whether the request was accepted rather than declined.
 */
export async function notifyJoinRequestDecided(
  workspaceName: string | null,
  accepted: boolean,
): Promise<void> {
  const device = useNotificationSettingsStore.getState();
  if (!device.enabled) return;
  const title = `Your request to join ${workspaceName ?? "a workspace"} was ${
    accepted ? "accepted" : "declined"
  }`;
  const body = accepted
    ? "The workspace is in your workspace list now."
    : "You can ask to join it again in 24 hours.";
  if (detectPlatform() === "desktop") {
    try {
      await showDesktopNotification({ title, body, sound: device.soundEnabled });
    } catch (err) {
      logger.debug("[RIM:JoinRequests] desktop notification unavailable", err);
    }
    return;
  }
  if (accepted) toast.success(title, { description: body });
  else toast.info(title, { description: body });
}
