import { useState } from "react";
import { Inbox, LogOut, Search, Settings, Sparkles } from "lucide-react";

import { useCurrentUser } from "../../features/workspaces/api/useCurrentUser";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useLogoutMutation } from "../../features/auth/api/useAuthMutations";
import { useShellStore } from "../state/useShellStore";
import { cn } from "../../shared/ui/cn";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";

const railItems = [
  { key: "inbox" as const, label: "Inbox", icon: Inbox },
  { key: "search" as const, label: "Search", icon: Search },
  { key: "plugins" as const, label: "Plugins", icon: Sparkles },
];

export function SideRail() {
  const activePanel = useShellStore((s) => s.activePanel);
  const setActivePanel = useShellStore((s) => s.setActivePanel);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const { data: user } = useCurrentUser();

  const avatarInitial = (user?.displayName ?? user?.username ?? "?").charAt(0).toUpperCase();

  function handleRailItemClick(key: "inbox" | "search" | "plugins") {
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
                  : "text-rim-text-muted hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col items-center gap-1 pb-2">
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "settings" })}
          title="Settings"
          aria-label="Settings"
          className={cn(
            "rounded-xl p-2.5 transition",
            mainSurface.kind === "settings"
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:bg-white/5 hover:text-white",
          )}
        >
          <Settings className="h-5 w-5" />
        </button>
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

  function handleAvatarClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.bottom - 8,
    });
  }

  function handleSignOut() {
    setMenuPosition(null);
    logout.mutate(undefined, { onSuccess: clearSession });
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
