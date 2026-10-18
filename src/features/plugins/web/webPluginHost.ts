// The host of WebSandboxed plugins, on the web and on the desktop: one hidden
// sandboxed frame per enabled plugin, loading the frame shell and speaking
// protocol v1 over a transferred MessagePort; the command gates in the order of
// the desktop's `command_exec.rs`; panel state through `WebPanelRelay`; each
// plugin's own storage and settings, scoped by the plugin the port belongs to;
// and safe start, so a plugin the page died starting is not started again.

import { checkFiles, type Bundle, type BundleFile } from "./bundle";
import {
  NETWORK_FETCH,
  parseNetworkOrigin,
  siteOf,
} from "../../../../sdk/plugin-sdk/src/manifestRules";
import {
  COMMAND_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  InvalidResultError,
  PluginSession,
  SessionClosedError,
  SessionTimeoutError,
  type CommandOutput,
  type LogLevel,
  type SessionPort,
} from "./pluginSession";
import { ErrorCode, RpcError, type Principal, type PrincipalMapping } from "./rpc";
import { PanelStateTooLargeError, WebPanelRelay } from "./webPanelRelay";

/** The `allow` attribute of every plugin frame: no powerful feature at all. */
export const FRAME_ALLOW =
  "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; " +
  "clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; " +
  "usb 'none'; serial 'none'; hid 'none'; bluetooth 'none'";

/** The only `sandbox` value a plugin frame ever gets. */
export const FRAME_SANDBOX = "allow-scripts";

/** Where the frame shell is served: the web app's own origin, or the desktop's custom protocol. */
export const WEB_SHELL_URL = "/plugin-frame/v1/index.html";
export const DESKTOP_SHELL_URL = "rim-plugin://shell/v1/index.html";

/** Shown for a plugin whose start the page died in. */
export const SAFE_START_MESSAGE =
  "The app closed while starting this plugin, so it was not started again. Turn it off and on to retry.";

/** A plugin's frame window, as much of it as the host uses. */
export interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

/** One iframe the host made. */
export interface FrameHandle {
  readonly window: FrameWindow | null;
  /** Call `listener` on every `load` event of the iframe. */
  onLoad(listener: () => void): void;
  remove(): void;
}

/** A `message` event on the host window. */
export interface WindowMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

/** What the host needs from the page; tests pass fakes. */
export interface HostEnvironment {
  shellUrl: string;
  hostVersion: string;
  createFrame(title: string): FrameHandle;
  listen(listener: (message: WindowMessage) => void): () => void;
  createChannel(): { host: SessionPort; plugin: Transferable };
  isHidden(): boolean;
  log(pluginId: string, level: LogLevel, message: string): void;
}

/** A web plugin's verified files. */
export interface LoadedPlugin {
  manifestText: string;
  files: BundleFile[];
}

/** What the host needs from the store of installed plugins. */
export interface HostServices {
  loadFiles(pluginId: string): Promise<LoadedPlugin>;
  setStarting(pluginId: string, starting: boolean): Promise<void>;
  storageGet(pluginId: string, key: string): Promise<unknown>;
  storageSet(pluginId: string, key: string, value: unknown): Promise<void>;
  /**
   * The settings `pluginId` reads for the signed-in account: saved values over
   * defaults, secret ones in plain form where the store keeps them.
   */
  pluginSettings(pluginId: string): Promise<Record<string, unknown>>;
}

/** Answers a plugin's `rim.chat.*` call with the capabilities it started with. */
export type ChatHandler = (
  pluginId: string,
  method: string,
  params: unknown,
  granted: readonly string[],
) => Promise<unknown>;

/** A manifest command, as far as the gates need it. */
export interface GatedCommand {
  id: string;
  dangerous: boolean;
  required_capabilities?: string[];
}

/** An installed web plugin, as the plugin list reports it. */
export interface InstalledWebPlugin {
  pluginId: string;
  displayName: string;
  enabled: boolean;
  /** The marker of a start the page may have died in. */
  starting: boolean;
  approvedCapabilities: string[];
  commands: GatedCommand[];
}

export type WebPluginHealth = "starting" | "running" | "stopped" | "crashed";

export interface WebPluginStatus {
  health: WebPluginHealth;
  /** Why the plugin stopped on its own, or why it was not started. */
  error?: string;
}

/** A command the host refused or that failed, shaped as the desktop's `PluginCommandError`. */
export class WebCommandError extends Error {
  readonly kind: string;
  readonly data: unknown;

  constructor(kind: string, message: string, data?: unknown) {
    super(message);
    this.name = "WebCommandError";
    this.kind = kind;
    this.data = data;
  }
}

/** One run of a command, as the palette, a keybind, a panel or the agent asks for it. */
export interface CommandRequest {
  pluginId: string;
  commandId: string;
  args?: unknown;
  /** The user confirmed this run of a dangerous command. Never true for the agent. */
  confirmed?: boolean;
  /** Set when a panel asked; the command must then be that plugin's own. */
  callerPluginId?: string;
  initiator?: "user" | "agent";
}

interface Entry {
  plugin: InstalledWebPlugin;
  status: WebPluginStatus;
  session: PluginSession | null;
  frame: FrameHandle | null;
  unlisten: (() => void) | null;
  loaded: Bundle | null;
  origins: string[];
  /** Stopped on its own; not started again until the user turns it off. */
  blocked: boolean;
  /** In its shutdown grace period. */
  stopping: boolean;
  capabilities: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const sortedJoin = (list: readonly string[]) => [...list].sort().join("\n");

export class WebPluginHost {
  readonly relay = new WebPanelRelay();
  private env: HostEnvironment | null = null;
  private services: HostServices | null = null;
  private forbiddenOrigins: readonly string[] = [];
  private readonly entries = new Map<string, Entry>();
  private installed = new Map<string, InstalledWebPlugin>();
  /** Plugins this page launched, whose `starting` marker is its own. */
  private readonly launched = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private principal: Principal | null = null;
  private mappings: readonly PrincipalMapping[] = [];
  private chat: ChatHandler | null = null;

  /** Connect the host to the page, the store and, when given, the message service. */
  configure(
    env: HostEnvironment,
    services: HostServices,
    forbiddenOrigins: readonly string[] = [],
    chat: ChatHandler | null = null,
  ) {
    this.env = env;
    this.services = services;
    this.forbiddenOrigins = forbiddenOrigins;
    this.chat = chat;
  }

  /** Called on every status change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  status(pluginId: string): WebPluginStatus {
    return this.entries.get(pluginId)?.status ?? { health: "stopped" };
  }

  /** True when `pluginId` is an installed web plugin. */
  knows(pluginId: string): boolean {
    return this.installed.has(pluginId);
  }

  /**
   * Bring the running frames in line with the installed plugins: start each
   * enabled plugin, stop each disabled or removed one, and restart one whose
   * approved capabilities changed, since its policy is fixed when it loads.
   */
  reconcile(plugins: readonly InstalledWebPlugin[]): void {
    this.installed = new Map(plugins.map((p) => [p.pluginId, p]));
    let changed = false;
    for (const [id, entry] of this.entries) {
      const plugin = this.installed.get(id);
      if (!plugin || !plugin.enabled) {
        if (entry.blocked) {
          entry.blocked = false;
          entry.status = { health: "stopped" };
          changed = true;
        }
        if (this.isActive(entry)) void this.stop(id);
        else if (!plugin) this.entries.delete(id);
        continue;
      }
      entry.plugin = plugin;
      const capabilities = sortedJoin(plugin.approvedCapabilities);
      if (this.isActive(entry) && capabilities !== entry.capabilities) void this.stop(id);
    }
    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      const entry = this.entries.get(plugin.pluginId);
      if (entry && (entry.blocked || this.isActive(entry) || entry.stopping)) continue;
      if (plugin.starting && !this.launched.has(plugin.pluginId)) {
        this.block(plugin, SAFE_START_MESSAGE);
        changed = true;
        continue;
      }
      void this.launch(plugin);
    }
    if (changed) this.emit();
  }

  private isActive(entry: Entry): boolean {
    return entry.status.health === "starting" || entry.status.health === "running";
  }

  private block(plugin: InstalledWebPlugin, error: string): void {
    this.entries.set(plugin.pluginId, {
      ...this.blankEntry(plugin),
      status: { health: "crashed", error },
      blocked: true,
    });
  }

  private blankEntry(plugin: InstalledWebPlugin): Entry {
    return {
      plugin,
      status: { health: "stopped" },
      session: null,
      frame: null,
      unlisten: null,
      loaded: null,
      origins: [],
      blocked: false,
      stopping: false,
      capabilities: sortedJoin(plugin.approvedCapabilities),
    };
  }

  private async launch(plugin: InstalledWebPlugin): Promise<void> {
    const env = this.env;
    const services = this.services;
    if (!env || !services) return;
    const id = plugin.pluginId;
    const entry: Entry = { ...this.blankEntry(plugin), status: { health: "starting" } };
    this.entries.set(id, entry);
    this.launched.add(id);
    this.emit();
    const current = () => this.entries.get(id) === entry;

    let loaded: Bundle;
    try {
      await services.setStarting(id, true);
      const files = await services.loadFiles(id);
      loaded = checkFiles(files.files);
      if (loaded.manifest.plugin_id !== id || loaded.manifest.runtime_kind !== "WebSandboxed") {
        throw new Error(`the installed files are not the web plugin ${id}`);
      }
      entry.origins = this.grantedOrigins(plugin, loaded);
    } catch (error) {
      if (current()) this.kill(id, (error as Error).message || "bundle damaged or unavailable");
      return;
    }
    if (!current()) return;
    entry.loaded = loaded;

    const channel = env.createChannel();
    const frame = env.createFrame(`Plugin: ${plugin.displayName}`);
    const chat = this.chat;
    entry.frame = frame;
    const session = new PluginSession(
      channel.host,
      {
        pluginId: id,
        hostVersion: env.hostVersion,
        grantedCapabilities: plugin.approvedCapabilities,
        principal: this.principal,
        mappings: this.mappings,
        isHidden: () => env.isHidden(),
      },
      {
        log: (level, message) => env.log(id, level, message),
        updatePanel: (panelId, state, patch) => this.updatePanel(id, panelId, state, patch),
        storageGet: (key) => services.storageGet(id, key),
        storageSet: (key, value) => services.storageSet(id, key, value),
        settingsGet: () => services.pluginSettings(id),
        ...(chat
          ? {
              chat: (method: string, params: unknown) =>
                chat(id, method, params, plugin.approvedCapabilities),
            }
          : {}),
        stopped: (reason) => this.kill(id, reason),
      },
    );
    entry.session = session;

    entry.unlisten = env.listen((message) => {
      if (message.source !== frame.window || message.origin !== "null") return;
      const data = message.data;
      if (isRecord(data) && data.type === "rim.frame.error" && data.v === 1) {
        const why = typeof data.message === "string" ? data.message.slice(0, 500) : "unknown error";
        this.kill(id, `the plugin failed to load: ${why}`);
      }
    });

    // A shell that never loads is caught by the same deadline as a handshake.
    let loads = 0;
    const loadTimer = setTimeout(() => {
      if (current() && loads === 0) this.kill(id, "the plugin frame did not load");
    }, HANDSHAKE_TIMEOUT_MS);
    frame.onLoad(() => {
      loads += 1;
      if (!current()) return;
      if (loads > 1) {
        this.kill(id, "the plugin navigated its frame");
        return;
      }
      clearTimeout(loadTimer);
      const entryFile = loaded.files.find((f) => f.path === loaded.manifest.entrypoint);
      const bytes = entryFile ? entryFile.bytes.slice().buffer : new ArrayBuffer(0);
      frame.window?.postMessage(
        {
          type: "rim.frame.init",
          v: 1,
          kind: "plugin",
          pluginId: id,
          manifest: loaded.manifestText,
          policy: { origins: entry.origins },
          files: [{ path: loaded.manifest.entrypoint, type: "text/javascript", bytes }],
        },
        "*",
        [channel.plugin, bytes],
      );
      session.handshake().then(
        () => {
          if (!current()) return;
          entry.status = { health: "running" };
          void services.setStarting(id, false);
          this.emit();
        },
        () => {
          // The session already reported why through `stopped`.
        },
      );
    });
  }

  /** Granted origins: the manifest's, when `network.fetch` is approved, never RIM's own. */
  private grantedOrigins(plugin: InstalledWebPlugin, loaded: Bundle): string[] {
    if (!plugin.approvedCapabilities.includes(NETWORK_FETCH)) return [];
    const origins = loaded.manifest.network_origins ?? [];
    const forbidden = this.forbiddenOrigins
      .map((o) => {
        try {
          const url = new URL(o);
          return url.port && url.port !== "443" ? `${url.hostname}:${url.port}` : url.hostname;
        } catch {
          return null;
        }
      })
      .filter((s): s is string => s !== null);
    for (const origin of origins) {
      if (forbidden.includes(siteOf(parseNetworkOrigin(origin)))) {
        throw new Error(`${origin} is RIM's own origin, which a plugin may never reach`);
      }
    }
    return origins;
  }

  private updatePanel(pluginId: string, panelId: string, state: unknown, patch: boolean): unknown {
    const panels = this.entries.get(pluginId)?.loaded?.manifest.panels ?? [];
    if (!panels.some((p) => p.id === panelId)) {
      throw new RpcError(
        ErrorCode.CAPABILITY_DENIED,
        `panel '${panelId}' is not declared in plugin '${pluginId}' manifest`,
      );
    }
    try {
      if (patch) {
        return { panel_id: panelId, state: this.relay.patchState(pluginId, panelId, state) };
      }
      this.relay.setState(pluginId, panelId, state);
      return { panel_id: panelId, state };
    } catch (error) {
      if (error instanceof PanelStateTooLargeError) {
        throw new RpcError(ErrorCode.INTERNAL_ERROR, error.message);
      }
      throw error;
    }
  }

  /** Remove a plugin's frame now: it failed, navigated, flooded or stopped answering. */
  private kill(pluginId: string, reason: string): void {
    const entry = this.entries.get(pluginId);
    if (!entry) return;
    const wasStarting = entry.status.health === "starting";
    this.teardown(entry);
    entry.status = { health: "crashed", error: reason };
    entry.blocked = true;
    this.env?.log(pluginId, "warn", `stopped: ${reason}`);
    if (wasStarting) void this.services?.setStarting(pluginId, false).catch(() => {});
    this.emit();
  }

  private teardown(entry: Entry): void {
    entry.session?.close();
    entry.frame?.remove();
    entry.unlisten?.();
    entry.session = null;
    entry.frame = null;
    entry.unlisten = null;
    entry.loaded = null;
    this.relay.cleanupPlugin(entry.plugin.pluginId);
  }

  /** Stop a plugin: `rim.shutdown`, one second of grace, then the frame is removed. */
  async stop(pluginId: string): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry || !this.isActive(entry)) return;
    const session = entry.session;
    const frame = entry.frame;
    const wasStarting = entry.status.health === "starting";
    entry.status = { health: "stopped" };
    entry.stopping = true;
    this.emit();
    entry.session = null;
    await session?.shutdown();
    entry.stopping = false;
    if (entry.frame === frame) this.teardown(entry);
    if (wasStarting) await this.services?.setStarting(pluginId, false).catch(() => {});
    this.emit();
    // Started again if it is still enabled: its capabilities changed, or it was
    // turned back on during the grace period.
    this.reconcile([...this.installed.values()]);
  }

  /** The signed-in user changed. */
  setPrincipal(principal: Principal | null): void {
    this.principal = principal;
    for (const entry of this.entries.values()) entry.session?.setPrincipal(principal);
  }

  /** The user saved or reset `pluginId`'s settings: its running session sends the new ones. */
  settingsChanged(pluginId: string): void {
    this.entries.get(pluginId)?.session?.settingsChanged();
  }

  /** Every provisional-to-key mapping this device knows. */
  setMappings(mappings: readonly PrincipalMapping[]): void {
    this.mappings = mappings;
    for (const entry of this.entries.values()) entry.session?.setMappings(mappings);
  }

  /** A running plugin's files under `panels/<panelId>/`, with paths relative to it. */
  panelFiles(pluginId: string, panelId: string): BundleFile[] | null {
    const entry = this.entries.get(pluginId);
    if (!entry?.loaded || entry.status.health !== "running") return null;
    const prefix = `panels/${panelId}/`;
    return entry.loaded.files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => ({ path: f.path.slice(prefix.length), bytes: f.bytes }));
  }

  /** The origins a running plugin's frames may reach. */
  panelOrigins(pluginId: string): string[] {
    return this.entries.get(pluginId)?.origins ?? [];
  }

  /**
   * Find `(pluginId, commandId)` among the installed web plugins. The UI splits
   * `plugin.<id>.<command>` at the first dot, but plugin ids have dots, so the
   * joined id is also matched against every installed id, the longest winning.
   */
  resolve(
    pluginId: string,
    commandId: string,
  ): { plugin: InstalledWebPlugin; command: GatedCommand } | null {
    const direct = this.installed.get(pluginId);
    const declared = direct?.commands.find((c) => c.id === commandId);
    if (direct && declared) return { plugin: direct, command: declared };
    const joined = `${pluginId}.${commandId}`;
    let best: { plugin: InstalledWebPlugin; command: GatedCommand } | null = null;
    for (const plugin of this.installed.values()) {
      if (!joined.startsWith(`${plugin.pluginId}.`)) continue;
      const command = plugin.commands.find(
        (c) => c.id === joined.slice(plugin.pluginId.length + 1),
      );
      if (command && (!best || plugin.pluginId.length > best.plugin.pluginId.length)) {
        best = { plugin, command };
      }
    }
    return best;
  }

  /**
   * Run a command through the gates, in the desktop's order: arguments, the
   * command declared, the caller's scope, the dangerous-command confirmation,
   * required capabilities, the plugin running; then 30 seconds to answer.
   */
  async execute(request: CommandRequest): Promise<CommandOutput> {
    const initiator = request.initiator ?? "user";
    // Only a person confirms: an agent's run is always unconfirmed.
    const confirmed = request.confirmed === true && initiator !== "agent";
    const args = request.args ?? {};
    if (!isRecord(args)) {
      throw new WebCommandError(
        "INVALID_ARGS",
        `command arguments must be a JSON object, got ${Array.isArray(args) ? "an array" : `a ${typeof args}`}`,
      );
    }
    const resolved = this.resolve(request.pluginId, request.commandId);
    if (!resolved) {
      if (this.installed.has(request.pluginId)) {
        throw new WebCommandError(
          "UNKNOWN_COMMAND",
          `command \`${request.commandId}\` is not declared by plugin ${request.pluginId}`,
        );
      }
      throw new WebCommandError("PLUGIN_NOT_FOUND", `plugin not found: ${request.pluginId}`);
    }
    const { plugin, command } = resolved;
    const id = plugin.pluginId;
    if (request.callerPluginId !== undefined && request.callerPluginId !== id) {
      throw new WebCommandError(
        "OUT_OF_SCOPE",
        `plugin ${request.callerPluginId} may not run commands of plugin ${id}`,
      );
    }
    if (command.dangerous && !confirmed) {
      throw new WebCommandError(
        "CONFIRMATION_REQUIRED",
        `command \`${command.id}\` is marked dangerous and needs confirmation`,
      );
    }
    const missing = (command.required_capabilities ?? []).find(
      (c) => !plugin.approvedCapabilities.includes(c),
    );
    if (missing) {
      throw new WebCommandError(
        "CAPABILITY_DENIED",
        `command \`${command.id}\` needs capability \`${missing}\`, which is not approved`,
      );
    }
    const session = this.entries.get(id)?.session;
    if (!session || !session.running) {
      throw new WebCommandError("PLUGIN_NOT_RUNNING", `plugin is not running: ${id}`);
    }
    try {
      return await session.execute(
        {
          commandId: command.id,
          args,
          invoker: this.principal,
          initiator,
          confirmed: command.dangerous && confirmed,
        },
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof SessionTimeoutError) {
        throw new WebCommandError("TIMED_OUT", `plugin ${id} did not answer within 30s`);
      }
      if (error instanceof SessionClosedError) {
        throw new WebCommandError("PLUGIN_NOT_RUNNING", `plugin is not running: ${id}`);
      }
      if (error instanceof InvalidResultError) {
        throw new WebCommandError(
          "INVALID_RESULT",
          `plugin ${id} answered with an invalid command result: ${error.message}`,
        );
      }
      if (error instanceof RpcError) {
        throw new WebCommandError("PLUGIN_ERROR", `plugin error: ${error.message}`, {
          code: error.code,
          data: error.data ?? null,
        });
      }
      throw error;
    }
  }
}

/** The host every part of the app shares. */
export const webPluginHost = new WebPluginHost();
