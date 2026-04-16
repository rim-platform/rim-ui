import { useState, lazy, Suspense } from "react";
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
const PluginSettingsPage = lazy(() => import("../../plugins/components/PluginSettingsPage").then(m => ({ default: m.PluginSettingsPage })));
const AgentSettingsPanel = lazy(() => import("../../agent/settings/AgentSettingsPanel").then(m => ({ default: m.AgentSettingsPanel })));
const EmojiManagement = lazy(() => import("../../emoji/components/EmojiManagement").then(m => ({ default: m.EmojiManagement })));

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
  const shellPlaceholder =
    navigator.platform.startsWith("Win")
      ? "e.g. pwsh.exe, cmd.exe, C:\\Program Files\\Git\\bin\\bash.exe"
      : "e.g. /bin/zsh, /usr/bin/fish, /bin/bash";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Terminal</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Integrated terminal running your system shell. Toggle with Ctrl+` (Cmd+` on macOS) when enabled.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-rim-line bg-rim-panel p-4">
        <div>
          <p className="text-sm font-medium text-rim-text">Enable Terminal</p>
          <p className="text-xs text-rim-text-muted">
            Show the integrated terminal pane. When disabled, the terminal shortcut and UI are hidden.
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
          Path to the shell executable. Leave empty to use your system default.
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
            Using default: Nerd Font Mono variants, then JetBrains Mono / Fira Code / system monospace
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
        Font and size changes apply to new terminal sessions.
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

type SettingsTab = "profile" | "keybinds" | "commands" | "macros" | "pipelines" | "plugins" | "emoji" | "agent" | "notifications" | "terminal" | "account" | "about";

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "keybinds", label: "Keybinds" },
  { key: "commands", label: "Commands" },
  { key: "macros", label: "Macros" },
  { key: "pipelines", label: "Pipelines" },
  { key: "plugins", label: "Plugins" },
  { key: "emoji", label: "Emoji" },
  { key: "agent", label: "AI Agent" },
  { key: "notifications", label: "Notifications" },
  { key: "terminal", label: "Terminal" },
  { key: "account", label: "Account" },
  { key: "about", label: "About" },
];

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

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
            {activeTab === "emoji" && (
              <EmojiManagement serverId={workspaceId} isAdmin />
            )}
            {activeTab === "agent" && <AgentSettingsPanel />}
            {activeTab === "notifications" && <NotificationSettings />}
            {activeTab === "terminal" && <TerminalSettings />}
            {activeTab === "account" && (
              <AccountSettings onNavigateToProfile={() => setActiveTab("profile")} />
            )}
            {activeTab === "about" && (
              <p className="text-sm text-rim-text-muted">About RIM coming soon.</p>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
