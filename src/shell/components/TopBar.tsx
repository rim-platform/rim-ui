import { useCallback, useRef, useState } from "react";
import { ChevronDown, Search, Sparkles } from "lucide-react";

import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { showInvisibleCharacters } from "../../features/agents/runtime/invisibleCharacters";
import { runDesktopLocalCommand } from "../../features/commands/runtime/commandDispatcher";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { NotificationBellButton } from "../../features/notifications/components/NotificationBellButton";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { runningPluginPanels } from "../../features/plugins/pluginPanels";
import { useIsDirectSpace, useRelayStore } from "../../features/relay/state/useRelayStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { cn } from "../../shared/ui/cn";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { WindowControls } from "../../shared/ui/WindowControls";
import { useShellWidth } from "../hooks/useShellWidth";
import { useShellStore } from "../state/useShellStore";
import { NavMenuButton } from "./NavMenuButton";
import { PluginPanelMenu } from "./PluginPanelMenu";

/** The search box's accessible name while it shows only its icon. */
export const SEARCH_BOX_NAME = "Search or run a command";

/**
 * The bar above the conversation list and the main area: the navigation button in a narrow
 * window, the search box in the middle, and Plugins and Notifications on the right. In the
 * desktop app's own window frame it is also the title bar: its empty areas drag the window, and
 * the window controls sit at its far right outside macOS.
 */
export function TopBar() {
  const { capabilities, osType } = useRuntime();
  const titleBar = capabilities.customTitleBar;
  const narrow = useShellWidth() === "narrow";
  // Marks an empty area that drags the window in the desktop app's own frame.
  const drag = titleBar ? { "data-tauri-drag-region": true } : {};
  const windowControls = titleBar && osType !== "macos";

  return (
    <header
      aria-label="Top bar"
      data-panel="topBar"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("topBar")}
      {...drag}
      className={cn(
        "relative flex h-12 shrink-0 items-center gap-2 border-b border-rim-line bg-rim-void pl-3 outline-none",
        !windowControls && "pr-3",
      )}
    >
      <div {...drag} className={cn("flex h-full items-center", !narrow && "min-w-0 flex-1")}>
        <NavMenuButton />
      </div>
      <SearchBox narrow={narrow} />
      <div
        {...drag}
        className={cn(
          "ml-auto flex h-full items-center justify-end gap-1",
          !narrow && "min-w-0 flex-1",
        )}
      >
        <PluginsButton narrow={narrow} />
        <NotificationBellButton />
        {windowControls && <WindowControls className="ml-2" />}
      </div>
    </header>
  );
}

/**
 * The open workspace's name for the search box: from the workspace list, or the stored space of
 * a workspace on another server; `null` while it is not known.
 */
function useOpenWorkspaceName(workspaceId: string | null): string | null {
  const { data: servers } = useMyServers();
  const remote = useRelayStore((s) => (workspaceId ? s.spaces[workspaceId]?.name : undefined));
  if (!workspaceId) return null;
  return servers?.find((server) => server.id === workspaceId)?.name ?? remote ?? null;
}

/**
 * What the search box says it searches: everything on Home and Unreads, the direct messages in
 * the direct space, and otherwise the open workspace by name.
 */
function useSearchBoxText(): string {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const acrossWorkspaces = useShellStore(
    (s) => s.mainSurface.kind === "home" || s.mainSurface.kind === "unreads",
  );
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const name = useOpenWorkspaceName(workspaceId);
  if (acrossWorkspaces) return "Search everything, or run a command";
  if (inDirectSpace) return "Search your direct messages, or run a command";
  if (!name) return "Search this workspace, or run a command";
  return `Search ${showInvisibleCharacters(name)}, or run a command`;
}

/**
 * A button that looks like a search box and opens search. It shows the keystroke bound to
 * search on its right, and below 400 px only its icon.
 */
function SearchBox({ narrow }: { narrow: boolean }) {
  const text = useSearchBoxText();
  const keystroke = useKeybindLabel("workspace.open_search");

  return (
    <button
      type="button"
      onClick={() => runDesktopLocalCommand("workspace.open_search")}
      aria-keyshortcuts={keystroke ?? undefined}
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 text-left text-sm text-rim-text-muted transition hover:border-rim-text-faint hover:text-rim-text max-[399px]:w-8 max-[399px]:flex-none max-[399px]:justify-center max-[399px]:px-0",
        narrow ? "flex-1" : "w-full max-w-xl flex-[2]",
      )}
    >
      <Search aria-hidden className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate max-[399px]:hidden">{text}</span>
      <span className="sr-only min-[400px]:hidden">{SEARCH_BOX_NAME}</span>
      {keystroke && !narrow && (
        <kbd
          aria-hidden
          className="shrink-0 rounded border border-rim-line px-1.5 py-0.5 font-mono text-[11px] text-rim-text-faint"
        >
          {keystroke}
        </kbd>
      )}
    </button>
  );
}

/**
 * Plugins: opens the menu of the running plugins' panels under it. It is not shown while no
 * running plugin has a panel, and is marked while a plugin panel shows.
 */
function PluginsButton({ narrow }: { narrow: boolean }) {
  const { data: plugins } = usePluginList();
  const pluginPanels = runningPluginPanels(plugins);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  // Plugin panels show only on the conversation surface.
  const panelShown = mainSurface.kind === "conversation" ? activePluginPanel : null;
  // Where the menu opens, under the button; null while it is closed.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);

  if (pluginPanels.length === 0) return null;

  return (
    <>
      <HoverTooltip
        content={<span className="text-xs text-rim-text whitespace-nowrap">Plugin panels</span>}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuAt((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }));
          }}
          aria-label="Plugins"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          aria-current={panelShown ? "page" : undefined}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm transition",
            panelShown
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
          )}
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          {!narrow && (
            <>
              <span>Plugins</span>
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </HoverTooltip>
      {menuAt && (
        <PluginPanelMenu
          panels={pluginPanels}
          shown={panelShown}
          position={menuAt}
          anchorRef={buttonRef}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
