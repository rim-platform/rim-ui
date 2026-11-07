import { useState, type ReactNode } from "react";
import { ClipboardList, LogOut, Settings } from "lucide-react";

import { SignOutDialog } from "../../features/auth/components/SignOutDialog";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { StatusDropdown } from "../../features/settings/components/StatusDropdown";
import { useCurrentUser } from "../../features/workspaces/api/useCurrentUser";
import { Avatar } from "../../shared/ui/Avatar";
import { cn } from "../../shared/ui/cn";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useShellStore } from "../state/useShellStore";

/**
 * The foot of the workspace rail: the audit log while a workspace is open, Settings, and the
 * account menu.
 *
 * @param auditLog - Whether a workspace other than the direct space is open, so its audit log
 *   button shows.
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

/** A rail button with a tooltip naming it and, when one is bound, its keystroke. */
function RailButton({
  label,
  commandId,
  current,
  onClick,
  children,
}: {
  label: string;
  commandId: string;
  current: boolean;
  onClick: () => void;
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
        onClick={onClick}
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
    <RailButton
      label="Audit log"
      commandId="workspace.open_audit_log"
      current={current}
      onClick={() => useShellStore.getState().setMainSurface({ kind: "audit-log" })}
    >
      <ClipboardList aria-hidden className="h-4 w-4" />
    </RailButton>
  );
}

function SettingsButton() {
  const current = useShellStore((s) => s.mainSurface.kind === "settings");
  return (
    <RailButton
      label="Settings"
      commandId="workspace.open_settings"
      current={current}
      onClick={() => useShellStore.getState().setMainSurface({ kind: "settings" })}
    >
      <Settings aria-hidden className="h-4 w-4" />
    </RailButton>
  );
}

/** The signed-in person's avatar at the foot of the rail, opening status, settings and sign-out. */
function UserMenu() {
  const { data: user } = useCurrentUser();
  const username = user?.username;
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [statusPosition, setStatusPosition] = useState<{ x: number; y: number } | null>(null);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const [signOutOpen, setSignOutOpen] = useState(false);

  function handleAvatarClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.bottom - 8,
    });
  }

  function handleSignOut() {
    setMenuPosition(null);
    setSignOutOpen(true);
  }

  function handleSettings() {
    setMenuPosition(null);
    setMainSurface({ kind: "settings" });
  }

  function handleOpenStatus() {
    if (!menuPosition) return;
    setStatusPosition({ x: menuPosition.x, y: menuPosition.y });
    setMenuPosition(null);
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
              onSelect: handleSettings,
            },
            {
              id: "signout",
              label: "Sign out...",
              icon: <LogOut className="h-4 w-4" />,
              danger: true,
              onSelect: handleSignOut,
            },
          ]}
        />
      )}

      {statusPosition && (
        <StatusDropdown position={statusPosition} onClose={() => setStatusPosition(null)} />
      )}

      <SignOutDialog open={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </div>
  );
}
