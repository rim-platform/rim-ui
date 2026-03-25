import { useState } from "react";
import { X } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { KeybindSettings } from "../../commands/components/KeybindSettings";
import { UserCommandSettings } from "../../commands/components/UserCommandSettings";
import { cn } from "../../../shared/ui/cn";

type SettingsTab = "keybinds" | "commands" | "account" | "about";

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "keybinds", label: "Keybinds" },
  { key: "commands", label: "Commands" },
  { key: "account", label: "Account" },
  { key: "about", label: "About" },
];

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const [activeTab, setActiveTab] = useState<SettingsTab>("keybinds");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-rim-line px-8 py-4">
        <h1 className="text-lg font-semibold text-white">Settings</h1>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "conversation" })}
          title="Close settings"
          aria-label="Close settings"
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-white"
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
          {activeTab === "keybinds" && <KeybindSettings />}
          {activeTab === "commands" && <UserCommandSettings />}
          {activeTab === "account" && (
            <p className="text-sm text-rim-text-muted">Account settings coming soon.</p>
          )}
          {activeTab === "about" && (
            <p className="text-sm text-rim-text-muted">About RIM coming soon.</p>
          )}
        </div>
      </div>
    </div>
  );
}
