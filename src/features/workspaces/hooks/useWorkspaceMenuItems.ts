import { useCallback } from "react";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { formatTime } from "../../../shared/utils/formatTime";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { QUICK_ACCESS_SHORTCUT } from "../../commands/state/useQuickAccessStore";
import { unreadTotal, useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useNotificationSettings } from "../../notifications/api/useNotificationSettings";
import { PAUSE_DURATIONS, pauseArguments } from "../../notifications/pauseCommand";
import { isPauseActive } from "../../notifications/rules";
import { joinRequestBadge, useJoinRequestCount } from "../api/publicJoinLink";
import { useCanHavePublicLink } from "./useCanHavePublicLink";
import { useIsDefaultWorkspace } from "./useIsDefaultWorkspace";
import { useMyServerRole } from "../api/useMyServerRole";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { canCreateChannel, canModerate, isGuest, isOwner } from "../role";
import { canLeaveWorkspace, canRenameWorkspace } from "../workspaceActions";

interface UseWorkspaceMenuItemsOptions {
  workspaceId: string;
  /**
   * Whether to load the viewer's role and notification settings in the workspace, which the
   * menu needs; until then the items that depend on them are left out.
   */
  enabled: boolean;
}

/**
 * The menu of a workspace on the rail. It acts on that workspace without opening it, except
 * Workspace settings, which goes there: Mark all as read (when something is unread), Pause
 * notifications with its durations and Resume notifications while paused, Browse channels…
 * (not for guests), Workspace settings (Owner and Moderator, who have that page), Join
 * requests… with the number waiting (Owner and Moderator, while requests are open), Invite
 * people… (the Owner), Create channel… (not for guests, and in the server's default workspace
 * only for its Owner and Moderators), Rename workspace… (the Owner), Assign keybind… and
 * Leave workspace… (anyone but the Owner, not in the server's default workspace), the last two
 * on a server that supports them. Each item runs its command as a context-menu run on that
 * workspace.
 *
 * @returns A function that gives the items when the menu opens.
 */
export function useWorkspaceMenuItems({
  workspaceId,
  enabled,
}: UseWorkspaceMenuItemsOptions): () => DropdownMenuItem[] {
  const role = useMyServerRole(enabled ? workspaceId : undefined);
  const { data: settings } = useNotificationSettings(enabled ? workspaceId : null);
  const canHaveLink = useCanHavePublicLink(workspaceId, enabled);
  const inDefault = useIsDefaultWorkspace(workspaceId);
  const { info } = useServerInfo();
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const { data: requestCount } = useJoinRequestCount(
    workspaceId,
    enabled && canModerate(role) && canHaveLink,
  );
  const requestBadge = joinRequestBadge(requestCount);

  return useCallback(() => {
    /** Runs `commandId` on this workspace as a context-menu item. */
    const run = (commandId: string, args?: Record<string, unknown>) =>
      void runCommandFromClick(commandId, args, { source: "menu", target: { workspaceId } });
    const items: DropdownMenuItem[] = [];
    const { counts, spaceOf } = useUnreadStore.getState();
    if (unreadTotal(counts, spaceOf, (space) => space === workspaceId) > 0) {
      items.push({
        id: "mark-all-read",
        label: "Mark all as read",
        onSelect: () => run("chat.mark_all_as_read"),
      });
    }

    const pause = (until: Date | null) =>
      void runCommandFromClick("notifications.dnd", pauseArguments(until), {
        source: "menu",
        target: { workspaceId },
        successToast: until
          ? `Notifications paused until ${formatTime(until.toISOString())}`
          : "Notifications resumed",
        errorTitle: "Pause notifications",
      });
    const paused = settings ? isPauseActive(settings) : false;
    items.push({
      id: "pause-notifications",
      label: "Pause notifications",
      detail:
        paused && settings?.dndPausedUntil
          ? `Paused until ${formatTime(settings.dndPausedUntil)}`
          : paused
            ? "Paused"
            : undefined,
      submenu: PAUSE_DURATIONS.map((p) => ({
        id: p.id,
        label: p.label,
        onSelect: () => pause(p.until()),
      })),
    });
    if (paused) {
      items.push({
        id: "resume-notifications",
        label: "Resume notifications",
        onSelect: () => pause(null),
      });
    }

    // Unknown until the role loads; a guest may not browse or create channels.
    const member = role !== undefined && !isGuest(role);
    if (member) {
      items.push({
        id: "browse-channels",
        label: "Browse channels…",
        onSelect: () => run("chat.browse_channels"),
      });
    }
    if (canModerate(role)) {
      items.push({
        id: "workspace-settings",
        label: "Workspace settings",
        onSelect: () => run("workspace.open_workspace_settings"),
      });
    }
    if (canModerate(role)) {
      items.push({
        id: "reports",
        label: "Reports…",
        onSelect: () => run("moderation.open_reports"),
      });
    }
    if (canModerate(role) && requestBadge) {
      items.push({
        id: "join-requests",
        label: "Join requests…",
        detail: `${requestBadge} waiting`,
        onSelect: () => run("workspace.open_join_requests"),
      });
    }
    if (isOwner(role)) {
      items.push({
        id: "invite",
        label: "Invite people…",
        onSelect: () => run("admin.invite_member"),
      });
    }
    if (canCreateChannel(role, inDefault)) {
      items.push({
        id: "create-channel",
        label: "Create channel…",
        onSelect: () => run("chat.create_channel"),
      });
    }
    const facts = {
      role,
      inDirectSpace,
      isDefault: inDefault,
      capabilities: info?.capabilities,
    };
    if (canRenameWorkspace(facts)) {
      items.push({
        id: "rename-workspace",
        label: "Rename workspace…",
        onSelect: () => run("workspace.rename"),
      });
    }
    items.push({
      id: "assign-keybind",
      label: "Assign keybind…",
      shortcut: QUICK_ACCESS_SHORTCUT,
      onSelect: () => run("settings.assign_keybind"),
    });
    if (canLeaveWorkspace(facts)) {
      items.push({
        id: "leave-workspace",
        label: "Leave workspace…",
        danger: true,
        separatorBefore: true,
        onSelect: () => run("workspace.leave"),
      });
    }
    return items;
  }, [workspaceId, role, settings, requestBadge, inDefault, info, inDirectSpace]);
}
