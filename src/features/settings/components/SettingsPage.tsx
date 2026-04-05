import { useState } from "react";
import { X } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { KeybindSettings } from "../../commands/components/KeybindSettings";
import { UserCommandSettings } from "../../commands/components/UserCommandSettings";
import { PluginSettingsPage } from "../../plugins/components/PluginSettingsPage";
import { AgentSettingsPanel } from "../../agent/settings/AgentSettingsPanel";
import { NotificationSettings } from "../../notifications/components/NotificationSettings";
import { MacroSettings } from "../../macros/components/MacroSettings";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { EmojiManagement } from "../../emoji/components/EmojiManagement";
import { cn } from "../../../shared/ui/cn";

type SettingsTab = "profile" | "keybinds" | "commands" | "macros" | "plugins" | "emoji" | "agent" | "notifications" | "account" | "about";

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "keybinds", label: "Keybinds" },
  { key: "commands", label: "Commands" },
  { key: "macros", label: "Macros" },
  { key: "plugins", label: "Plugins" },
  { key: "emoji", label: "Emoji" },
  { key: "agent", label: "AI Agent" },
  { key: "notifications", label: "Notifications" },
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
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
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
          {activeTab === "profile" && <ProfileSettings />}
          {activeTab === "keybinds" && <KeybindSettings />}
          {activeTab === "commands" && <UserCommandSettings />}
          {activeTab === "macros" && <MacroSettings />}
          {activeTab === "plugins" && <PluginSettingsPage />}
          {activeTab === "emoji" && (
            <EmojiManagement serverId={workspaceId} isAdmin />
          )}
          {activeTab === "agent" && <AgentSettingsPanel />}
          {activeTab === "notifications" && <NotificationSettings />}
          {activeTab === "account" && (
            <AccountSettings onNavigateToProfile={() => setActiveTab("profile")} />
          )}
          {activeTab === "about" && (
            <p className="text-sm text-rim-text-muted">About RIM coming soon.</p>
          )}
        </div>
      </div>
    </div>
  );
}
