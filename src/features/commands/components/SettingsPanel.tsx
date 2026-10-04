import { useState } from "react";
import { KeybindSettings } from "./KeybindSettings";
import { UserCommandSettings } from "./UserCommandSettings";
import { cn } from "../../../shared/ui/cn";

type SettingsTab = "keybinds" | "commands";

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("keybinds");

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex border-b border-rim-line">
        <button
          className={cn(
            "flex-1 px-4 py-2 text-xs font-medium transition-colors",
            activeTab === "keybinds"
              ? "border-b-2 border-rim-accent text-rim-text"
              : "text-rim-text-muted hover:text-rim-text",
          )}
          onClick={() => setActiveTab("keybinds")}
        >
          Keybinds
        </button>
        <button
          className={cn(
            "flex-1 px-4 py-2 text-xs font-medium transition-colors",
            activeTab === "commands"
              ? "border-b-2 border-rim-accent text-rim-text"
              : "text-rim-text-muted hover:text-rim-text",
          )}
          onClick={() => setActiveTab("commands")}
        >
          Commands
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "keybinds" && <KeybindSettings />}
        {activeTab === "commands" && <UserCommandSettings />}
      </div>
    </div>
  );
}
