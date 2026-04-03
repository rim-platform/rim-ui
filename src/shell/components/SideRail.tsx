import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, LogOut, Puzzle, Search, Settings, Sparkles } from "lucide-react";

import { useCurrentUser } from "../../features/workspaces/api/useCurrentUser";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useLogoutMutation } from "../../features/auth/api/useAuthMutations";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";
import { cn } from "../../shared/ui/cn";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";

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

  const avatarInitial = (user?.displayName ?? user?.username ?? "?").charAt(0).toUpperCase();

  // Collect all panels from enabled, running plugins
  const pluginPanels = (plugins ?? [])
    .filter((p) => p.enabled && p.health === "running")
    .flatMap((p) =>
      (p.manifest.panels ?? []).map((panel) => ({
        pluginId: p.manifest.id,
        pluginName: p.manifest.name,
        panel,
      })),
    );

  const openSearch = useSearchOverlayStore((s) => s.openWithScope);

  function handleRailItemClick(key: "inbox" | "plugins") {
    setMainSurface({ kind: "conversation" });
    setActivePanel(key);
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-rim-line bg-rim-panel py-4">
      <nav className="flex flex-1 flex-col items-center gap-1">
        {railItems.map((item) => {
          const Icon = item.icon;
          const active = mainSurface.kind === "conversation" && activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleRailItemClick(item.key)}
              title={item.label}
              aria-label={item.label}
              className={cn(
                "rounded-xl p-2.5 transition",
                active
                  ? "bg-rim-accent/15 text-rim-accent"
                  : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}

        <SearchButton openSearch={openSearch} />

        {/* Plugin panel icons */}
        {pluginPanels.length > 0 && (
          <>
            <div className="my-1 h-px w-6 bg-rim-line" />
            {pluginPanels.map(({ pluginId, pluginName, panel }) => {
              const isActive =
                activePluginPanel?.pluginId === pluginId &&
                activePluginPanel?.panelId === panel.id;
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
                      : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
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
        <SettingsButton
          mainSurface={mainSurface}
          setMainSurface={setMainSurface}
        />
      </div>

      <UserMenu avatarInitial={avatarInitial} username={user?.username} />
    </aside>
  );
}

function UserMenu({ avatarInitial, username }: { avatarInitial: string; username?: string }) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
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
    </div>
  );
}

function SearchButton({ openSearch }: { openSearch: (scope: { kind: "all" }) => void }) {
  const keystroke = useKeybindLabel("workspace.open_search");
  const label = keystroke ? `Search workspace (${keystroke})` : "Search workspace";

  return (
    <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}>
      <button
        type="button"
        onClick={() => openSearch({ kind: "all" })}
        aria-label="Search workspace"
        className="rounded-xl p-2.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
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
    <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}>
      <button
        type="button"
        onClick={() => setMainSurface({ kind: "settings" })}
        aria-label="Settings"
        className={cn(
          "rounded-xl p-2.5 transition",
          mainSurface.kind === "settings"
            ? "bg-rim-accent/15 text-rim-accent"
            : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
        )}
      >
        <Settings className="h-5 w-5" />
      </button>
    </HoverTooltip>
  );
}
