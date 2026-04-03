export type TrustLevel = "official" | "verified" | "community" | "unverified";

export type PluginCapability =
  | "filesystem"
  | "network"
  | "notifications"
  | "clipboard"
  | "shell"
  | "system_info";

export type PluginContextType = "message" | "conversation";

export interface PluginCommandDef {
  id: string;
  title: string;
  description: string;
  context_menu_action?: boolean;
  context_types?: PluginContextType[];
  suggested_keybind?: string;
}

export type PluginPanelSlot = "tool_panel" | "main_area";

export interface PluginPanelDef {
  id: string;
  title: string;
  slot: PluginPanelSlot;
  icon?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  trust_level: TrustLevel;
  capabilities: PluginCapability[];
  commands?: PluginCommandDef[];
  panels?: PluginPanelDef[];
}

export type PluginHealth = "running" | "stopped" | "crashed" | "timeout";

export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  approved_capabilities: PluginCapability[];
  health: PluginHealth;
}

export interface PluginCommandResult {
  status: "ok" | "error";
  payload: unknown;
}

export type PluginEventKind =
  | "plugin_started"
  | "plugin_stopped"
  | "plugin_crashed"
  | "plugin_timeout"
  | "plugin_log";

export interface PluginEvent {
  plugin_id: string;
  kind: PluginEventKind;
  message?: string;
  timestamp: string;
}
