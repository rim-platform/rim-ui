import { useCallback, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Search, Sparkles } from "lucide-react";

import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { showInvisibleCharacters } from "../../features/agents/runtime/invisibleCharacters";
import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { NotificationBellButton } from "../../features/notifications/components/NotificationBellButton";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { runningPluginPanels } from "../../features/plugins/pluginPanels";
import { useIsDirectSpace } from "../../features/relay/state/useRelayStore";
import { useWorkspaceName } from "../../features/workspaces/hooks/useWorkspaceName";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { cn } from "../../shared/ui/cn";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { WindowControls } from "../../shared/ui/WindowControls";
import { useShellWidth } from "../hooks/useShellWidth";
import { goBack, goForward, useCanGoBack, useCanGoForward } from "../navigation/history";
import { useShellStore } from "../state/useShellStore";
import { NavMenuButton } from "./NavMenuButton";
import { PluginPanelMenu } from "./PluginPanelMenu";

/** The search field's accessible name below 400 px, where it says only "Search". */
export const SEARCH_BOX_NAME = "Search or run a command";

/**
 * The bar above the conversation list and the main area: Back and Forward on the left, or the
 * navigation button in a narrow window, the search field in the middle, and Plugins and
 * Notifications on the right. In the
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
      <div {...drag} className={cn("flex h-full items-center", !narrow && "flex-1")}>
        {narrow ? <NavMenuButton /> : <HistoryButtons />}
      </div>
      <SearchField narrow={narrow} />
      <div
        {...drag}
        className={cn("ml-auto flex h-full items-center justify-end gap-1", !narrow && "flex-1")}
      >
        <PluginsButton narrow={narrow} />
        <NotificationBellButton />
        {windowControls && <WindowControls className="ml-2" />}
      </div>
    </header>
  );
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
  const name = useWorkspaceName(workspaceId);
  if (acrossWorkspaces) return "Search everything, or run a command";
  if (inDirectSpace) return "Search your direct messages, or run a command";
  if (!name) return "Search this workspace, or run a command";
  return `Search ${showInvisibleCharacters(name)}, or run a command`;
}

/**
 * Back and Forward through the places opened in this window, never the browser's own history.
 * Each runs its command, and its tooltip names the keystroke bound to it, if any.
 */
function HistoryButtons() {
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  return (
    <div className="flex items-center gap-0.5">
      <HistoryButton
        label="Back"
        commandId="workspace.go_back"
        enabled={canGoBack}
        onClick={goBack}
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
      </HistoryButton>
      <HistoryButton
        label="Forward"
        commandId="workspace.go_forward"
        enabled={canGoForward}
        onClick={goForward}
      >
        <ArrowRight aria-hidden className="h-4 w-4" />
      </HistoryButton>
    </div>
  );
}

function HistoryButton({
  label,
  commandId,
  enabled,
  onClick,
  children,
}: {
  label: string;
  commandId: string;
  enabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const keystroke = useKeybindLabel(commandId);
  return (
    <HoverTooltip
      content={
        <span className="text-xs text-rim-text whitespace-nowrap">
          {keystroke ? `${label} (${keystroke})` : label}
        </span>
      }
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts={keystroke ?? undefined}
        disabled={!enabled}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text disabled:pointer-events-none disabled:opacity-40"
      >
        {children}
      </button>
    </HoverTooltip>
  );
}

/**
 * A button that looks like a search field and opens the search box. It shows the keystroke
 * bound to search on its right, and below 400 px only the word "Search".
 */
function SearchField({ narrow }: { narrow: boolean }) {
  const text = useSearchBoxText();
  const keystroke = useKeybindLabel("workspace.open_search");

  return (
    <button
      type="button"
      onClick={() => void runCommandFromClick("workspace.open_search")}
      aria-keyshortcuts={keystroke ?? undefined}
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 text-left text-sm text-rim-text-muted transition hover:border-rim-text-faint hover:text-rim-text",
        narrow ? "flex-1" : "w-full max-w-xl flex-[2]",
      )}
    >
      <Search aria-hidden className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate max-[399px]:hidden">{text}</span>
      <span aria-hidden className="min-w-0 flex-1 truncate min-[400px]:hidden">
        Search
      </span>
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
