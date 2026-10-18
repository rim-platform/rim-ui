import { useCallback } from "react";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  QUICK_ACCESS_SHORTCUT,
  useQuickAccessStore,
} from "../../commands/state/useQuickAccessStore";
import { markWorkspaceRead } from "../../conversations/api/useMarkAsRead";
import { unreadTotal, useUnreadStore } from "../../conversations/state/useUnreadStore";
import {
  useNotificationSettings,
  useSetDoNotDisturb,
} from "../../notifications/api/useNotificationSettings";
import { inOneHour, isPauseActive, tomorrowMorning } from "../../notifications/rules";
import { useMyServerRole } from "../api/useMyServerRole";
import { canModerate, isGuest, isOwner } from "../role";
import { useWorkspaceStore } from "../state/useWorkspaceStore";

/** A dialog a workspace's menu opens for that workspace. */
export type WorkspaceMenuDialog = "invite" | "browse-channels" | "create-channel";

const PAUSES: { id: string; label: string; until: () => Date }[] = [
  { id: "pause-1h", label: "For 1 hour", until: () => inOneHour() },
  {
    id: "pause-8h",
    label: "For 8 hours",
    until: () => new Date(Date.now() + 8 * 60 * 60 * 1000),
  },
  { id: "pause-tomorrow", label: "Until tomorrow morning", until: () => tomorrowMorning() },
];

interface UseWorkspaceMenuItemsOptions {
  workspaceId: string;
  /** The workspace's name as the rail shows it, for the keybind assigner. */
  label: string;
  /**
   * Whether to load the viewer's role and notification settings in the workspace, which the
   * menu needs; until then the items that depend on them are left out.
   */
  enabled: boolean;
  onOpenDialog: (dialog: WorkspaceMenuDialog) => void;
}

/**
 * The menu of a workspace on the rail. It acts on that workspace without opening it, except
 * Workspace settings, which goes there: Mark all as read (when something is unread), Pause
 * notifications with its durations and Resume notifications while paused, Browse channels…
 * and Create channel… (not for guests), Workspace settings (Owner and Moderator, who have
 * that page), Invite people… (the Owner) and Assign keybind….
 *
 * @returns A function that gives the items when the menu opens.
 */
export function useWorkspaceMenuItems({
  workspaceId,
  label,
  enabled,
  onOpenDialog,
}: UseWorkspaceMenuItemsOptions): () => DropdownMenuItem[] {
  const role = useMyServerRole(enabled ? workspaceId : undefined);
  const { data: settings } = useNotificationSettings(enabled ? workspaceId : null);
  const { mutate: setDnd } = useSetDoNotDisturb();

  return useCallback(() => {
    const items: DropdownMenuItem[] = [];
    const { counts, spaceOf } = useUnreadStore.getState();
    if (unreadTotal(counts, spaceOf, (space) => space === workspaceId) > 0) {
      items.push({
        id: "mark-all-read",
        label: "Mark all as read",
        onSelect: () => markWorkspaceRead(workspaceId),
      });
    }

    const pause = (paused: boolean, until: Date | null) =>
      setDnd(
        { serverId: workspaceId, paused, until: until ? until.toISOString() : null },
        {
          onSuccess: () =>
            toast.success(
              until
                ? `Notifications paused until ${formatTime(until.toISOString())}`
                : "Notifications resumed",
            ),
          onError: (err) => toast.error(graphqlErrorMessage(err, "Could not change the pause")),
        },
      );
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
      submenu: PAUSES.map((p) => ({
        id: p.id,
        label: p.label,
        onSelect: () => pause(true, p.until()),
      })),
    });
    if (paused) {
      items.push({
        id: "resume-notifications",
        label: "Resume notifications",
        onSelect: () => pause(false, null),
      });
    }

    // Unknown until the role loads; a guest may not browse or create channels.
    const member = role !== undefined && !isGuest(role);
    if (member) {
      items.push({
        id: "browse-channels",
        label: "Browse channels…",
        onSelect: () => onOpenDialog("browse-channels"),
      });
    }
    if (canModerate(role)) {
      items.push({
        id: "workspace-settings",
        label: "Workspace settings",
        onSelect: () => {
          const workspaces = useWorkspaceStore.getState();
          if (workspaces.workspaceId !== workspaceId) workspaces.setWorkspaceId(workspaceId);
          useShellStore.getState().setMainSurface({ kind: "settings", tab: "workspace" });
        },
      });
    }
    if (isOwner(role)) {
      items.push({
        id: "invite",
        label: "Invite people…",
        onSelect: () => onOpenDialog("invite"),
      });
    }
    if (member) {
      items.push({
        id: "create-channel",
        label: "Create channel…",
        onSelect: () => onOpenDialog("create-channel"),
      });
    }
    items.push({
      id: "assign-keybind",
      label: "Assign keybind…",
      shortcut: QUICK_ACCESS_SHORTCUT,
      onSelect: () =>
        useQuickAccessStore.getState().open({ kind: "workspace", workspaceId, label }),
    });
    return items;
  }, [workspaceId, label, role, settings, setDnd, onOpenDialog]);
}
