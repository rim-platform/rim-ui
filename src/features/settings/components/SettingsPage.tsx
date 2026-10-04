import { useState, useEffect, lazy, Suspense } from "react";
import { X, Loader2 } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { KeybindSettings } from "../../commands/components/KeybindSettings";
import { UserCommandSettings } from "../../commands/components/UserCommandSettings";
import { NotificationSettings } from "../../notifications/components/NotificationSettings";
import { MacroSettings } from "../../macros/components/MacroSettings";
import { PipelineSettings } from "../../pipelines/components/PipelineSettings";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { cn } from "../../../shared/ui/cn";
import { useTerminalStore } from "../../terminal/state/useTerminalStore";

// Lazy-load heavier / rarely-used settings panels
const PluginSettingsPage = lazy(() =>
  import("../../plugins/components/PluginSettingsPage").then((m) => ({
    default: m.PluginSettingsPage,
  })),
);
const PluginAiConsentPanel = lazy(() =>
  import("../../plugins/components/PluginAiConsentPanel").then((m) => ({
    default: m.PluginAiConsentPanel,
  })),
);
const AgentSettingsPanel = lazy(() =>
  import("../../agent/settings/AgentSettingsPanel").then((m) => ({
    default: m.AgentSettingsPanel,
  })),
);
const EmojiManagement = lazy(() =>
  import("../../emoji/components/EmojiManagement").then((m) => ({ default: m.EmojiManagement })),
);
const WorkspaceStateSettings = lazy(() =>
  import("../../workspace-state/components/WorkspaceStateSettings").then((m) => ({
    default: m.WorkspaceStateSettings,
  })),
);
const IngestTokenSettings = lazy(() =>
  import("../../integrations/components/IngestTokenSettings").then((m) => ({
    default: m.IngestTokenSettings,
  })),
);

function TerminalSettings() {
  const enabled = useTerminalStore((s) => s.enabled);
  const setEnabled = useTerminalStore((s) => s.setEnabled);
  const preferredShell = useTerminalStore((s) => s.preferredShell);
  const setPreferredShell = useTerminalStore((s) => s.setPreferredShell);
  const fontFamily = useTerminalStore((s) => s.fontFamily);
  const setFontFamily = useTerminalStore((s) => s.setFontFamily);
  const fontSize = useTerminalStore((s) => s.fontSize);
  const setFontSize = useTerminalStore((s) => s.setFontSize);

  // Platform-specific placeholder
  const shellPlaceholder = navigator.platform.startsWith("Win")
    ? "pwsh.exe, powershell.exe or cmd.exe"
    : "e.g. /bin/zsh, /usr/bin/fish, /bin/bash";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Terminal</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Integrated terminal running your system shell. Toggle with Ctrl+` (Cmd+` on macOS) when
          enabled.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-rim-line bg-rim-panel p-4">
        <div>
          <p className="text-sm font-medium text-rim-text">Enable Terminal</p>
          <p className="text-xs text-rim-text-muted">
            Show the integrated terminal pane. When disabled, the terminal shortcut and UI are
            hidden.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
            enabled ? "bg-rim-accent" : "bg-rim-panel-soft",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-rim-text shadow-sm ring-0 transition-transform duration-200",
              enabled ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <label htmlFor="shell-path" className="block text-sm font-medium text-rim-text">
          Shell
        </label>
        <p className="mt-1 text-xs text-rim-text-muted">
          Leave empty to use your system default. For security, only shells listed in /etc/shells
          (Windows: pwsh.exe, powershell.exe, cmd.exe) are accepted, and RIM asks for confirmation
          before opening the first terminal of each session.
        </p>
        <input
          id="shell-path"
          type="text"
          value={preferredShell}
          onChange={(e) => setPreferredShell(e.target.value)}
          placeholder={shellPlaceholder}
          className="mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40"
        />
        {preferredShell.trim() && (
          <p className="mt-1.5 text-[11px] text-rim-text-faint">
            New sessions will open with: {preferredShell.trim()}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <label htmlFor="terminal-font" className="block text-sm font-medium text-rim-text">
          Font Family
        </label>
        <p className="mt-1 text-xs text-rim-text-muted">
          Monospace font for the terminal. Use a Nerd Font for oh-my-zsh / Powerlevel10k glyphs.
        </p>
        <input
          id="terminal-font"
          type="text"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          placeholder="e.g. MesloLGS NF, JetBrainsMono Nerd Font Mono"
          className="mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40"
        />
        {!fontFamily.trim() && (
          <p className="mt-1.5 text-[11px] text-rim-text-faint">
            Using default: Nerd Font Mono variants, then JetBrains Mono / Fira Code / system
            monospace
          </p>
        )}
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <label htmlFor="terminal-font-size" className="block text-sm font-medium text-rim-text">
          Font Size
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            id="terminal-font-size"
            type="range"
            min={8}
            max={24}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-rim-line accent-rim-accent"
          />
          <span className="w-8 text-center font-mono text-sm text-rim-text">{fontSize}</span>
        </div>
      </div>

      <p className="text-xs text-rim-text-faint">
        Font and size changes apply immediately to open terminals.
      </p>
    </div>
  );
}

function SettingsLoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-rim-accent" />
    </div>
  );
}

function AboutRim() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">About RIM</h2>
        <p className="mt-1 text-sm text-rim-text-muted">A programmable communication workspace.</p>
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rim-accent/10 text-rim-accent font-bold text-lg">
            R
          </div>
          <div>
            <p className="text-sm font-semibold text-rim-text">RIM</p>
            <p className="text-xs text-rim-text-faint">Version 0.1.0</p>
          </div>
        </div>

        <p className="text-sm text-rim-text-muted leading-relaxed">
          RIM is not another chat app. Chat is the communication layer &mdash; commands, keybinds,
          macros, and plugins are the product. Built for teams that think in workflows, not just
          messages.
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">Runtime</span>
            <p className="font-medium text-rim-text">Tauri 2 + React 19</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">Backend</span>
            <p className="font-medium text-rim-text">Rust + Actix + GraphQL</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">UI</span>
            <p className="font-medium text-rim-text">TypeScript + Tailwind CSS</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">License</span>
            <p className="font-medium text-rim-text">Proprietary</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-3">
        <p className="text-sm font-medium text-rim-text">Core Capabilities</p>
        <ul className="space-y-1.5 text-sm text-rim-text-muted">
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Command palette with 19+ keybinds and slash commands
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Macro builder with AI-assisted step generation
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Reactive pipelines &mdash; event-driven automation
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Plugin system with capability-based security
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            AI agent with tool-calling and multi-provider support
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Incident management with timeline and postmortem
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Channel lenses &mdash; filtered message views
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Integrated terminal with Nerd Font support
          </li>
        </ul>
      </div>

      <p className="text-xs text-rim-text-faint">
        Built with obsessive attention to developer workflows.
      </p>
    </div>
  );
}

type SettingsTab =
  | "profile"
  | "keybinds"
  | "commands"
  | "macros"
  | "pipelines"
  | "plugins"
  | "plugin-ai"
  | "emoji"
  | "state"
  | "agent"
  | "notifications"
  | "terminal"
  | "integrations"
  | "account"
  | "about";

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "keybinds", label: "Keybinds" },
  { key: "commands", label: "Commands" },
  { key: "macros", label: "Macros" },
  { key: "pipelines", label: "Pipelines" },
  { key: "plugins", label: "Plugins" },
  { key: "plugin-ai", label: "Plugin AI" },
  { key: "emoji", label: "Emoji" },
  { key: "state", label: "State" },
  { key: "agent", label: "AI Agent" },
  { key: "notifications", label: "Notifications" },
  { key: "terminal", label: "Terminal" },
  { key: "integrations", label: "Integrations" },
  { key: "account", label: "Account" },
  { key: "about", label: "About" },
];

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  // Resolve the requested tab from the surface, defaulting to "profile".
  // We validate that the requested tab actually exists in our tab list so a
  // stale or typo'd value doesn't silently show an empty panel.
  const resolveTab = (surface: typeof mainSurface): SettingsTab => {
    if (surface.kind === "settings" && surface.tab) {
      const found = tabs.find((t) => t.key === surface.tab);
      if (found) return found.key;
    }
    return "profile";
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(mainSurface));

  // When the caller navigates to settings again (e.g. "Manage plugins" while
  // settings is already open), the surface updates but the component stays
  // mounted, so we need to sync.
  useEffect(() => {
    if (mainSurface.kind === "settings") {
      setActiveTab(resolveTab(mainSurface));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSurface]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-rim-line px-8">
        <h1 className="text-lg font-semibold text-rim-text">Settings</h1>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "conversation" })}
          title="Close settings"
          aria-label="Close settings"
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-rim-line px-8">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-b-2 border-rim-accent text-rim-text"
                : "text-rim-text-muted hover:text-rim-text",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <Suspense fallback={<SettingsLoadingSpinner />}>
            {activeTab === "profile" && <ProfileSettings />}
            {activeTab === "keybinds" && <KeybindSettings />}
            {activeTab === "commands" && <UserCommandSettings />}
            {activeTab === "macros" && <MacroSettings />}
            {activeTab === "pipelines" && <PipelineSettings />}
            {activeTab === "plugins" && <PluginSettingsPage />}
            {activeTab === "plugin-ai" && <PluginAiConsentPanel />}
            {activeTab === "emoji" && <EmojiManagement serverId={workspaceId} />}
            {activeTab === "state" && (
              <WorkspaceStateSettings serverId={workspaceId ?? undefined} />
            )}
            {activeTab === "agent" && <AgentSettingsPanel />}
            {activeTab === "notifications" && <NotificationSettings />}
            {activeTab === "terminal" && <TerminalSettings />}
            {activeTab === "integrations" && <IngestTokenSettings serverId={workspaceId} />}
            {activeTab === "account" && (
              <AccountSettings onNavigateToProfile={() => setActiveTab("profile")} />
            )}
            {activeTab === "about" && <AboutRim />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
