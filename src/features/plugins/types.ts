export type TrustLevel = "official" | "verified" | "community" | "unverified";

// Authoritative list sourced from src-tauri/src/plugin_host/capability.rs METHOD_CAPABILITY_MAP.
// If Rust adds a new capability key, add it here and update capabilityLabels in PluginCapabilityPrompt.
export type PluginCapability =
  | "chat.read"
  | "chat.write"
  | "events.read"
  | "local.process"
  | "network"
  | "fs.read"
  | "fs.write"
  | "ui.notify"
  | "ui.panel";

/** Exhaustive tuple of all valid PluginCapability values — used for runtime validation. */
export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = [
  "chat.read",
  "chat.write",
  "events.read",
  "local.process",
  "network",
  "fs.read",
  "fs.write",
  "ui.notify",
  "ui.panel",
] as const;

/** Type guard: returns true when `v` is a known PluginCapability string. */
export function isPluginCapability(v: unknown): v is PluginCapability {
  return PLUGIN_CAPABILITIES.includes(v as PluginCapability);
}

/**
 * Defensively parses an unknown value into `PluginCapability[]`.
 * Unknown strings are dropped and logged. In production console.warn is the
 * only signal — TODO(P6-W3-followup): route through toast/audit when a shared
 * drift-signal subsystem exists.
 */
export function parsePluginCapabilities(value: unknown): PluginCapability[] {
  if (!Array.isArray(value)) {
    console.warn("[PluginCapability] expected array, got:", typeof value);
    return [];
  }
  return value.reduce<PluginCapability[]>((acc, v) => {
    if (isPluginCapability(v)) {
      acc.push(v);
    } else {
      console.warn("[PluginCapability] dropped unrecognised capability value:", v);
    }
    return acc;
  }, []);
}

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

/**
 * Mirror of the Rust `PluginInfo` struct returned by `plugin_list`.
 * All fields are flat — no nested manifest shape. Do NOT add polymorphic
 * field-fishing against this type; read the fields Rust populates directly.
 */
export interface PluginInfo {
  /** Runtime plugin ID (matches manifest plugin_id). */
  plugin_id: string;
  /** Mirror of the manifest plugin_id field, always identical to plugin_id. */
  manifest_id: string;
  display_name: string;
  version: string;
  description: string;
  author?: string;
  /** Derived server-side from status === Enabled. Do NOT recompute in TypeScript. */
  enabled: boolean;
  capabilities: string[];
  approved_capabilities: string[];
  approved_ai_commands: string[];
  /** Command IDs from the manifest that are flagged ai_callable: true. */
  ai_callable_commands: string[];
  /** True when the manifest changed since last consent — UI must prompt re-approval. */
  ai_consent_required: boolean;
  /**
   * True when the on-disk bundle fingerprint differs from the TOFU fingerprint
   * recorded at install time.  The UI must surface a warning and require the user
   * to trust the new version via `plugin_trust_fingerprint` before enabling.
   */
  fingerprint_changed: boolean;
  context_actions?: PluginContextAction[];
  /** Panel definitions from the manifest — used by the shell for slot layout. */
  panels?: PluginPanelDef[];
  health?: PluginHealth;
}

/**
 * Returned by `plugin_install_from_local` and `plugin_install_from_git` on success.
 * Mirror of the Rust `PluginInstallResult` struct.
 */
export interface PluginInstallResult {
  plugin_id: string;
  display_name: string;
  version: string;
  capabilities: string[];
  install_path: string;
}

export interface PluginContextAction {
  id: string;
  title: string;
  command_id: string;
  context_types: string[];
}

export interface PluginCommandResult {
  status: "ok" | "error";
  payload: unknown;
}

export type PluginEventKind =
  "plugin_started" | "plugin_stopped" | "plugin_crashed" | "plugin_timeout" | "plugin_log";

export interface PluginEvent {
  plugin_id: string;
  kind: PluginEventKind;
  message?: string;
  timestamp: string;
}
