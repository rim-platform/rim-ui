import { useState, type ReactNode } from "react";
import { ClipboardList, LogOut, Settings } from "lucide-react";

import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useAppDialogStore } from "../../features/commands/state/useAppDialogStore";
import { useCurrentUser } from "../../features/workspaces/api/useCurrentUser";
import { Avatar } from "../../shared/ui/Avatar";
import { cn } from "../../shared/ui/cn";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useShellStore } from "../state/useShellStore";

/**
 * The foot of the workspace rail: the audit log for a workspace's Owners and Moderators, Settings, and the
 * account menu.
 *
 * @param auditLog - Whether a workspace other than the direct space is open and the person
 *   moderates it, so its audit log button shows.
 */
export function RailFooter({ auditLog }: { auditLog: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {auditLog && <AuditLogButton />}
      <SettingsButton />
      <UserMenu />
    </div>
  );
}

/**
 * A rail button that runs `commandId`, with a tooltip naming it and, when one is bound, its
 * keystroke.
 */
function RailButton({
  label,
  commandId,
  current,
  children,
}: {
  label: string;
  commandId: string;
  current: boolean;
  children: ReactNode;
}) {
  const keystroke = useKeybindLabel(commandId);
  const tooltip = keystroke ? `${label} (${keystroke})` : label;
  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{tooltip}</span>}
    >
      <button
        type="button"
        onClick={() => void runCommandFromClick(commandId)}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl transition",
          current
            ? "bg-rim-accent/15 text-rim-accent"
            : "text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
        )}
      >
        {children}
      </button>
    </HoverTooltip>
  );
}

function AuditLogButton() {
  const current = useShellStore((s) => s.mainSurface.kind === "audit-log");
  return (
    <RailButton label="Audit log" commandId="workspace.open_audit_log" current={current}>
      <ClipboardList aria-hidden className="h-4 w-4" />
    </RailButton>
  );
}

function SettingsButton() {
  const current = useShellStore((s) => s.mainSurface.kind === "settings");
  return (
    <RailButton label="Settings" commandId="workspace.open_settings" current={current}>
      <Settings aria-hidden className="h-4 w-4" />
    </RailButton>
  );
}

/** The signed-in person's avatar at the foot of the rail, opening status, settings and sign-out. */
function UserMenu() {
  const { data: user } = useCurrentUser();
  const username = user?.username;
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  function handleAvatarClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.bottom - 8,
    });
  }

  /** Closes the menu and runs the command of the item chosen in it. */
  function runFromMenu(commandId: string) {
    setMenuPosition(null);
    void runCommandFromClick(commandId, undefined, { source: "menu" });
  }

  function handleOpenStatus() {
    // The status menu opens where the account menu was.
    if (menuPosition) useAppDialogStore.getState().anchorStatus(menuPosition);
    runFromMenu("people.set_status");
  }

  return (
    <div className="relative">
      <button
        type="button"
        title={username ?? "User"}
        aria-label={username ?? "User menu"}
        onClick={handleAvatarClick}
        className="rounded-full transition hover:brightness-110"
      >
        <Avatar
          url={user?.avatarUrl}
          name={user?.displayName || user?.username || "?"}
          userId={user?.id ?? "me"}
          size="md"
        />
      </button>

      {menuPosition && (
        <DropdownMenu
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          items={[
            {
              id: "status",
              label: "Set status...",
              icon: <span className="text-sm">{"\u{1F4AC}"}</span>,
              onSelect: handleOpenStatus,
            },
            {
              id: "settings",
              label: "Settings",
              icon: <Settings className="h-4 w-4" />,
              onSelect: () => runFromMenu("workspace.open_settings"),
            },
            {
              id: "signout",
              label: "Sign out...",
              icon: <LogOut className="h-4 w-4" />,
              danger: true,
              onSelect: () => runFromMenu("app.sign_out"),
            },
          ]}
        />
      )}
    </div>
  );
}
