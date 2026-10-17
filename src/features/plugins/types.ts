export type TrustLevel = "official" | "verified" | "community" | "unverified";

// Authoritative list sourced from src-tauri/src/plugin_host/capability.rs METHOD_CAPABILITY_MAP.
// If Rust adds a new capability key, add it here and update capabilityLabels in PluginCapabilityPrompt.
export type PluginCapability =
  | "chat.read"
  | "chat.write"
  | "chat.read.encrypted"
  | "chat.write.encrypted"
  | "events.read"
  | "local.process"
  | "network"
  | "fs.read"
  | "fs.write"
  | "ui.notify"
  | "ui.panel"
  | "network.fetch";

/** Exhaustive tuple of all valid PluginCapability values — used for runtime validation. */
export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = [
  "chat.read",
  "chat.write",
  "chat.read.encrypted",
  "chat.write.encrypted",
  "events.read",
  "local.process",
  "network",
  "fs.read",
  "fs.write",
  "ui.notify",
  "ui.panel",
  "network.fetch",
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
  description?: string;
  /** Left out by most manifests: the panel then opens next to the tool panel. */
  slot?: PluginPanelSlot;
  icon?: string;
}

/** Where the shell shows a panel; a manifest without `slot` gets the tool panel column. */
export function panelSlot(panel: PluginPanelDef): PluginPanelSlot {
  return panel.slot ?? "tool_panel";
}

/** One argument of a plugin command, as its manifest declares it. */
export interface PluginCommandArgument {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
}

/** A manifest command as `plugin_list` reports it. Mirror of the Rust `CommandInfo`. */
export interface PluginCommandInfo {
  /** The id in the manifest, e.g. `restart_pod`. */
  id: string;
  /** `plugin.<plugin_id>.<id>`, the id the palette and keybinds use. */
  qualified_id: string;
  title: string;
  description: string;
  keybind_capable: boolean;
  dangerous: boolean;
  ai_callable: boolean;
  arguments: PluginCommandArgument[];
  /** Context kinds the command runs in (`conversation`, `message`, `workspace`). */
  required_context?: string[];
  /** Capabilities the user must have approved before the command runs. */
  required_capabilities?: string[];
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

/** How a plugin runs: a program on the desktop, or sandboxed in the app's frames. */
export type PluginRuntimeKind = "DesktopLocalProcess" | "WebSandboxed";

/**
 * Where an installed plugin came from. Mirror of the Rust `InstallSource`; the
 * web app keeps the same shape in its install records.
 */
export type PluginInstallSource =
  | { kind: "local" }
  | { kind: "git"; url: string }
  | { kind: "link"; url: string; sha256: string }
  | {
      kind: "registry";
      endpoint: string;
      serverId: string;
      pluginId: string;
      statementSha256: string;
      publisherPrincipalId: string;
    };

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
  /** The bundle fingerprint on disk; left out by the web app and by older hosts. */
  current_fingerprint?: string | null;
  context_actions?: PluginContextAction[];
  /** Panel definitions from the manifest — used by the shell for slot layout. */
  panels?: PluginPanelDef[];
  /** Every manifest command, for the palette, the keybind picker and the agent. */
  commands?: PluginCommandInfo[];
  /** `running` once the plugin process (or, for a web plugin, its frame) finished its handshake. */
  health?: PluginHealth;
  /** Left out by older hosts, which only ran local processes. */
  runtime_kind?: PluginRuntimeKind;
  /** Origins a web plugin may reach once `network.fetch` is approved. */
  network_origins?: string[];
  source?: PluginInstallSource | null;
  /** The app died while starting this web plugin; it waits for the user to enable it again. */
  starting?: boolean;
  /** Why a web plugin stopped on its own, or was not started. */
  last_error?: string | null;
  /** Left out by hosts before the audit. */
  audit?: PluginAudit;
}

export type PluginGrantAction = "granted" | "revoked";

/** One capability given to or taken back from a plugin. Mirror of the Rust `GrantEvent`. */
export interface PluginGrantEvent {
  capability: string;
  action: PluginGrantAction;
  /** RFC 3339, UTC. */
  at: string;
}

/** Mirror of the Rust `PluginAudit`: grant history and encrypted reads per UTC day. */
export interface PluginAudit {
  grants: PluginGrantEvent[];
  /** `YYYY-MM-DD` to the encrypted messages the plugin read that day. */
  encrypted_reads: Record<string, number>;
}

/** The runtime kind of `plugin`; hosts before web plugins only reported local processes. */
export function runtimeKind(plugin: Pick<PluginInfo, "runtime_kind">): PluginRuntimeKind {
  return plugin.runtime_kind ?? "DesktopLocalProcess";
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

/**
 * One dependency-install command the host would run after installing or
 * updating a git plugin. Mirror of the Rust `PostInstallStep` struct.
 */
export interface PostInstallStep {
  program: string;
  args: string[];
  working_dir: string;
  /** File that triggered the step, e.g. `package.json`. */
  trigger_file: string;
  /** Exact command line, e.g. `npm install --production`. */
  command_line: string;
}

/**
 * Payload of the `POST_INSTALL_CONSENT_REQUIRED` error returned by
 * `plugin_install_from_git` / `plugin_update` when the plugin needs npm/pip
 * steps and the caller did not pass `allowPostInstall: true`.
 */
export interface PostInstallConsentRequest {
  plugin_id: string;
  steps: PostInstallStep[];
}

export const POST_INSTALL_CONSENT_REQUIRED = "POST_INSTALL_CONSENT_REQUIRED";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isPostInstallStep(v: unknown): v is PostInstallStep {
  return (
    isRecord(v) &&
    typeof v["program"] === "string" &&
    Array.isArray(v["args"]) &&
    v["args"].every((a) => typeof a === "string") &&
    typeof v["working_dir"] === "string" &&
    typeof v["trigger_file"] === "string" &&
    typeof v["command_line"] === "string"
  );
}

/**
 * Extract the consent request from a narrowed IPC error, or `null` when the
 * error is anything else (or the payload is malformed — in which case the
 * caller falls back to showing the error message, never to installing).
 */
export function parsePostInstallConsent(error: unknown): PostInstallConsentRequest | null {
  if (!isRecord(error) || error["kind"] !== "backend_error") return null;
  if (error["code"] !== POST_INSTALL_CONSENT_REQUIRED) return null;
  const data = error["data"];
  if (!isRecord(data) || typeof data["plugin_id"] !== "string") return null;
  const steps = data["steps"];
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(isPostInstallStep)) return null;
  return { plugin_id: data["plugin_id"], steps };
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
  /** One-line summary the plugin may return with a successful command. */
  message?: string;
}

export type PluginEventKind =
  "plugin_started" | "plugin_stopped" | "plugin_crashed" | "plugin_timeout" | "plugin_log";

export interface PluginEvent {
  plugin_id: string;
  kind: PluginEventKind;
  message?: string;
  timestamp: string;
}
