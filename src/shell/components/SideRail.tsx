import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Inbox, LogOut, Puzzle, Search, Settings, Sparkles } from "lucide-react";

import { useCurrentUser } from "../../features/workspaces/api/useCurrentUser";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useLogoutMutation } from "../../features/auth/api/useAuthMutations";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";
import { unreadTotal, useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useDirectSpaceIds } from "../../features/relay/api/useDirectInbox";
import { useIsDirectSpace } from "../../features/relay/state/useRelayStore";
import { NotificationBellButton } from "../../features/notifications/components/NotificationBellButton";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import { cn } from "../../shared/ui/cn";
import { handleVerticalStripKeys } from "../../shared/ui/focusNavigation";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { StatusDropdown } from "../../features/settings/components/StatusDropdown";

const railItems = [
  { key: "inbox" as const, label: "Inbox", icon: Inbox },
  { key: "plugins" as const, label: "Plugins", icon: Sparkles },
];

export function SideRail() {
  const activePanel = useShellStore((s) => s.activePanel);
  const setActivePanel = useShellStore((s) => s.setActivePanel);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const openPluginPanel = useShellStore((s) => s.openPluginPanel);
  const { data: user } = useCurrentUser();
  const { data: plugins } = usePluginList();
  // The open space's unread messages; in a direct space, those of every direct space.
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const directSpaceIds = useDirectSpaceIds();
  const totalUnread = useUnreadStore((s) =>
    unreadTotal(s.counts, s.spaceOf, (space) =>
      inDirectSpace ? directSpaceIds.includes(space) : space === workspaceId,
    ),
  );

  const avatarInitial = (user?.displayName ?? user?.username ?? "?").charAt(0).toUpperCase();

  // Collect all panels from enabled, running plugins
  const pluginPanels = (plugins ?? [])
    .filter((p) => p.enabled && p.health === "running")
    .flatMap((p) =>
      (p.panels ?? []).map((panel) => ({
        pluginId: p.plugin_id,
        pluginName: p.display_name,
        panel,
      })),
    );

  const openSearch = useSearchOverlayStore((s) => s.openWithScope);

  const notificationsOpen = useNotificationsPanelStore((s) => s.open);

  function handleRailItemClick(key: "inbox" | "plugins") {
    setMainSurface({ kind: "conversation" });
    setActivePanel(key);
    useNotificationsPanelStore.getState().setOpen(false);
  }

  return (
    <aside
      data-panel="sideRail"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("sideRail")}
      onKeyDown={handleVerticalStripKeys}
      className="flex w-14 shrink-0 flex-col items-center border-r border-rim-line bg-rim-panel py-4 outline-none"
    >
      <nav className="flex flex-1 flex-col items-center gap-1">
        {railItems.map((item) => {
          const Icon = item.icon;
          const active =
            mainSurface.kind === "conversation" && activePanel === item.key && !notificationsOpen;
          const badge = item.key === "inbox" && totalUnread > 0 ? totalUnread : 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleRailItemClick(item.key)}
              title={item.label}
              aria-label={badge ? `${item.label} (${badge} unread)` : item.label}
              className={cn(
                "relative rounded-xl p-2.5 transition",
                active
                  ? "bg-rim-accent/15 text-rim-accent"
                  : "text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text",
              )}
            >
              <Icon className="h-5 w-5" />
              {badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-danger px-1 text-[10px] font-bold leading-none text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}

        <NotificationBellButton />

        <SearchButton openSearch={openSearch} />

        {/* Plugin panel icons */}
        {pluginPanels.length > 0 && (
          <>
            <div className="my-1 h-px w-6 bg-rim-line" />
            {pluginPanels.map(({ pluginId, pluginName, panel }) => {
              const isActive =
                activePluginPanel?.pluginId === pluginId && activePluginPanel?.panelId === panel.id;
              return (
                <button
                  key={`${pluginId}-${panel.id}`}
                  type="button"
                  onClick={() => openPluginPanel(pluginId, panel.id)}
                  title={`${pluginName}: ${panel.title}`}
                  aria-label={`${pluginName}: ${panel.title}`}
                  className={cn(
                    "rounded-xl p-2.5 transition",
                    isActive
                      ? "bg-rim-accent/15 text-rim-accent"
                      : "text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text",
                  )}
                >
                  <Puzzle className="h-5 w-5" />
                </button>
              );
            })}
          </>
        )}
      </nav>

      <div className="flex flex-col items-center gap-1 pb-2">
        <AuditLogButton mainSurface={mainSurface} setMainSurface={setMainSurface} />
        <SettingsButton mainSurface={mainSurface} setMainSurface={setMainSurface} />
      </div>

      <UserMenu avatarInitial={avatarInitial} username={user?.username} />
    </aside>
  );
}

function UserMenu({ avatarInitial, username }: { avatarInitial: string; username?: string }) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [statusPosition, setStatusPosition] = useState<{ x: number; y: number } | null>(null);
  const clearSession = useAuthStore((s) => s.clearSession);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const logout = useLogoutMutation();
  const queryClient = useQueryClient();

  function handleAvatarClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.bottom - 8,
    });
  }

  function handleSignOut() {
    if (logout.isPending) return;
    setMenuPosition(null);
    logout.mutate(undefined, {
      onSuccess: () => {
        clearSession();
        useWorkspaceStore.getState().clearWorkspaceId();
        useShellStore.getState().reset();
        queryClient.clear();
      },
      onError: () => {
        // Still clear local state — user wanted to log out
        clearSession();
        useWorkspaceStore.getState().clearWorkspaceId();
        useShellStore.getState().reset();
        queryClient.clear();
      },
    });
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
        className="flex h-8 w-8 items-center justify-center rounded-full bg-rim-accent/20 text-xs font-medium text-rim-accent transition hover:bg-rim-accent/30"
      >
        {avatarInitial}
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
              label: logout.isPending ? "Signing out..." : "Sign out",
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
    </div>
  );
}

function SearchButton({ openSearch }: { openSearch: (scope: { kind: "all" }) => void }) {
  const keystroke = useKeybindLabel("workspace.open_search");
  const label = keystroke ? `Search workspace (${keystroke})` : "Search workspace";

  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
      <button
        type="button"
        onClick={() => openSearch({ kind: "all" })}
        aria-label="Search workspace"
        className="rounded-xl p-2.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
      >
        <Search className="h-5 w-5" />
      </button>
    </HoverTooltip>
  );
}

function SettingsButton({
  mainSurface,
  setMainSurface,
}: {
  mainSurface: { kind: string };
  setMainSurface: (surface: { kind: "settings" }) => void;
}) {
  const keystroke = useKeybindLabel("workspace.open_settings");
  const label = keystroke ? `Settings (${keystroke})` : "Settings";

  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
      <button
        type="button"
        onClick={() => setMainSurface({ kind: "settings" })}
        aria-label="Settings"
        className={cn(
          "rounded-xl p-2.5 transition",
          mainSurface.kind === "settings"
            ? "bg-rim-accent/15 text-rim-accent"
            : "text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text",
        )}
      >
        <Settings className="h-5 w-5" />
      </button>
    </HoverTooltip>
  );
}

function AuditLogButton({
  mainSurface,
  setMainSurface,
}: {
  mainSurface: { kind: string };
  setMainSurface: (surface: { kind: "audit-log" }) => void;
}) {
  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">Audit log</span>}
    >
      <button
        type="button"
        onClick={() => setMainSurface({ kind: "audit-log" })}
        aria-label="Audit log"
        className={cn(
          "rounded-xl p-2.5 transition",
          mainSurface.kind === "audit-log"
            ? "bg-rim-accent/15 text-rim-accent"
            : "text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text",
        )}
      >
        <ClipboardList className="h-5 w-5" />
      </button>
    </HoverTooltip>
  );
}
