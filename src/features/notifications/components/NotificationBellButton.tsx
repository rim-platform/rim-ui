import { Bell } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useUnreadNotificationCount } from "../api/useNotifications";
import { useNotificationsPanelStore } from "../state/useNotificationsPanelStore";

/** The side-rail bell: unread notification count, toggles the inbox in the tool panel. */
export function NotificationBellButton() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const open = useNotificationsPanelStore((s) => s.open);
  const toggle = useNotificationsPanelStore((s) => s.toggle);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const { data: count = 0 } = useUnreadNotificationCount(workspaceId);

  const active = open && mainSurface.kind === "conversation";
  const label = count > 0 ? `Notifications (${count} unread)` : "Notifications";

  function handleClick() {
    const shell = useShellStore.getState();
    if (shell.mainSurface.kind !== "conversation") {
      shell.setMainSurface({ kind: "conversation" });
      useNotificationsPanelStore.getState().setOpen(true);
      return;
    }
    toggle();
  }

  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">Notifications</span>}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        aria-pressed={active}
        disabled={!workspaceId}
        className={cn(
          "relative rounded-xl p-2.5 transition disabled:opacity-50",
          active
            ? "bg-rim-accent/15 text-rim-accent"
            : "text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text",
        )}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-danger px-1 text-[10px] font-bold leading-none text-rim-text"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
    </HoverTooltip>
  );
}
