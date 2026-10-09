import type * as wire from "./generated/protocol.ts";
import { ErrorCode, MAX_FRAME_BYTES, Method, PROTOCOL_VERSION } from "./generated/protocol.ts";
import { HostRequestError, PluginError, toWireError } from "./errors.ts";
import { FrameTooLargeError } from "./framing.ts";
import { parseManifestInfo, type ManifestInfo } from "./manifest.ts";
import {
  readPrincipal,
  readPrincipalMappings,
  samePrincipal,
  type Principal,
  type PrincipalMapping,
} from "./principal.ts";
import {
  portTransport,
  streamTransport,
  type FrameSink,
  type PortLike,
  type Transport,
} from "./transport.ts";

/** Protocol versions this SDK speaks, newest first. */
export const SUPPORTED_VERSIONS: readonly number[] = Object.freeze([PROTOCOL_VERSION]);

/** How long a plugin waits for the host to answer one of its requests. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Not frozen in v1: the broker routes it, but its shape may still change.
 * Needs the `ui.panel` capability.
 */
const UPDATE_PANEL_METHOD = "rim.ui.update_panel";

/**
 * Not frozen in v1: a WebSandboxed plugin's small store, kept by the host. A
 * local-process host answers both with `METHOD_NOT_FOUND`.
 */
const STORAGE_GET_METHOD = "rim.storage.get";
const STORAGE_SET_METHOD = "rim.storage.set";

/**
 * Not frozen in v1: the client message service. Reads need `chat.read` (and
 * `chat.read.encrypted` in encrypted DMs and groups); posting needs `chat.write`
 * (and `chat.write.encrypted`).
 */
const CHAT_LIST_MESSAGES_METHOD = "rim.chat.list_messages";
const CHAT_GET_MESSAGE_METHOD = "rim.chat.get_message";
const CHAT_SEARCH_MESSAGES_METHOD = "rim.chat.search_messages";
const CHAT_POST_MESSAGE_METHOD = "rim.chat.post_message";

/** Who started a command: a person (`user`) or the AI agent (`agent`). */
export type Initiator = wire.CommandExecuteParams["initiator"];

/** Severity of a line written to the host log. */
export type LogLevel = wire.LogParams["level"];

/** What a command hands back to the host. */
export interface CommandOutput {
  /** The command's output, any JSON-serialisable value. Leave it out for `null`. */
  payload?: unknown;
  /** One-line summary the host may show to the user. */
  message?: string;
}

/** Everything a command knows about the run it is handling. Frozen. */
export interface CommandContext {
  /** The command's id in `rim-plugin.json`. */
  readonly commandId: string;
  /** Arguments keyed by argument name; empty when there are none. Unvalidated: check them. */
  readonly args: Readonly<Record<string, unknown>>;
  /** The signed-in user the command runs for, or `null`. */
  readonly invoker: Principal | null;
  /** Whether a person or the AI agent started the command. */
  readonly initiator: Initiator;
  /**
   * True when the user confirmed this run of a dangerous command. A dangerous
   * command only runs when the host says so; the SDK offers no way to set it.
   */
  readonly confirmed: boolean;
  /** The connection to the host. */
  readonly host: Host;
}

/** One command the plugin implements. Its id is its key in `commands`. */
export interface CommandDefinition {
  /**
   * Set for commands that change or delete something. The host asks the user to
   * confirm each run and never lets the AI agent run it; the SDK refuses any run
   * that arrives unconfirmed. Keep it equal to `dangerous` in `rim-plugin.json`:
   * the SDK treats the command as dangerous when either one says so.
   */
  readonly dangerous?: boolean;
  /**
   * Run the command. Return `{ payload, message }`, nothing, or a promise of
   * either. Throw {@link PluginError} to fail with a specific code; anything
   * else thrown fails with `PLUGIN_ERROR` and its message.
   */
  readonly run: (context: CommandContext) => CommandOutput | void | Promise<CommandOutput | void>;
}

/** Lines written here appear in the RIM host log, prefixed with the plugin id. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Panel state the host keeps for each panel in `rim-plugin.json` and passes to
 * the panel's iframe.
 *
 * Experimental: `rim.ui.update_panel` is routed by the host but not frozen in
 * protocol v1, so its shape may change. It needs the `ui.panel` capability in
 * the manifest and approved by the user; without it the promise rejects with a
 * {@link HostRequestError} whose code is `CAPABILITY_DENIED`.
 */
export interface Panels {
  /** Replace a panel's state. */
  set(panelId: string, state: unknown): Promise<void>;
  /** Merge top-level keys into a panel's state. */
  patch(panelId: string, patch: Readonly<Record<string, unknown>>): Promise<void>;
}

/**
 * A small key-value store the host keeps for a WebSandboxed plugin, per
 * signed-in user and device: keys of 1 to 128 characters of `A-Z a-z 0-9 . _ -`,
 * any JSON as a value, 1 MiB in all. It is not secret: never keep tokens in it.
 *
 * Experimental: `rim.storage.*` is not frozen in protocol v1. A local-process
 * host has no store, so the promises reject with a {@link HostRequestError}
 * whose code is `METHOD_NOT_FOUND`.
 */
export interface Storage {
  /** The stored value of `key`, or `null`. */
  get(key: string): Promise<unknown>;
  /** Store `value` under `key`; `null` deletes the key. */
  set(key: string, value: unknown): Promise<void>;
}

/** A message as the person reads it. Ids of messages, conversations and threads are opaque. */
export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  /** The thread the message replies in, or `null`. */
  readonly threadId: string | null;
  readonly author: Principal;
  /** The body; mentions are `<@principalId>` tokens. */
  readonly text: string;
  /** RFC 3339. */
  readonly sentAt: string;
  readonly editedAt: string | null;
  /** The message was end-to-end encrypted. */
  readonly encrypted: boolean;
  /** Names, types and sizes only: plugins cannot fetch attachment bytes. */
  readonly attachments: readonly { name: string; mime: string; size: number }[];
}

/** A page of a conversation, oldest first. */
export interface ChatMessagePage {
  readonly messages: readonly ChatMessage[];
  /** Older messages exist; pass the first message's id as `before`. */
  readonly hasOlder: boolean;
}

/**
 * The person's messages, through the app's message service: read from what this device
 * stores, and posted as the person, encrypted where the conversation is.
 *
 * Experimental: `rim.chat.*` is routed by the hosts but not frozen in protocol v1. Each
 * call needs `chat.read` or `chat.write` approved, plus `chat.read.encrypted` or
 * `chat.write.encrypted` in an encrypted DM or group; without it the promise rejects with
 * a {@link HostRequestError} whose code is `CAPABILITY_DENIED`.
 */
export interface Chat {
  /** The newest messages of a conversation, or those before the message `before`. */
  listMessages(
    conversationId: string,
    options?: { before?: string; limit?: number },
  ): Promise<ChatMessagePage>;
  /** One message, or `null` when this device does not have it. */
  getMessage(messageId: string): Promise<ChatMessage | null>;
  /** Full-text search of the messages on this device, newest first. */
  searchMessages(
    query: string,
    options?: { conversationId?: string; limit?: number },
  ): Promise<ChatMessage[]>;
  /** Post as the person; answers the new message's id. */
  postMessage(
    conversationId: string,
    body: string,
    options?: { threadId?: string },
  ): Promise<{ id: string }>;
}

/** What the plugin knows about the host after the handshake. */
export interface Host {
  /** The plugin's id, as the host started it. */
  readonly pluginId: string;
  /** The RIM app's version. */
  readonly hostVersion: string;
  /** The protocol version this connection speaks. */
  readonly protocolVersion: number;
  /** Capabilities the user approved when the plugin started. Unknown names may appear. */
  readonly grantedCapabilities: readonly string[];
  /** The signed-in user right now, or `null`. */
  readonly principal: Principal | null;
  readonly log: Logger;
  readonly panels: Panels;
  readonly storage: Storage;
  readonly chat: Chat;
}

/** A plugin, as passed to {@link definePlugin}. */
export interface PluginDefinition {
  /** Must equal `plugin_id` in `rim-plugin.json`. */
  readonly id: string;
  /** Command handlers keyed by the command ids in `rim-plugin.json`. */
  readonly commands?: Readonly<Record<string, CommandDefinition>>;
  /** Called once the handshake is accepted. */
  readonly onReady?: (host: Host) => void | Promise<void>;
  /** Called when the user signs in, signs out or switches account. */
  readonly onPrincipalChanged?: (principal: Principal | null, host: Host) => void | Promise<void>;
  /**
   * Called with every provisional id the host has seen switch to a key-based id. Arrives
   * after every handshake while the host knows any, so rewrite stored ids idempotently:
   * replace each `from` with its `to` and leave other ids alone.
   */
  readonly onPrincipalsRemapped?: (
    mappings: readonly PrincipalMapping[],
    host: Host,
  ) => void | Promise<void>;
  /** Called before the plugin exits. The host kills it about a second later. */
  readonly onShutdown?: () => void | Promise<void>;
}

/**
 * How a plugin talks to the host. By default: the port in
 * `globalThis.rimPluginPort` when a WebSandboxed plugin's frame has one, else
 * the process's stdio.
 */
export interface RunOptions {
  /** The connection to the host, overriding the default. */
  readonly transport?: Transport;
  /** Frames from the host, over a byte stream. Defaults to `process.stdin`. */
  readonly input?: AsyncIterable<Uint8Array | string>;
  /** Frames to the host, over a byte stream. Defaults to `process.stdout`. */
  readonly output?: FrameSink;
  /**
   * The manifest to check the plugin against. Defaults to the text in
   * `globalThis.rimPluginManifest` in a plugin frame, else `rim-plugin.json` in
   * the working directory, which is the plugin directory when the host starts
   * it; a missing file is skipped. `false` skips the check.
   */
  readonly manifestPath?: string | false;
  /** Called with the exit code when the connection ends. Defaults to `process.exit` on stdio. */
  readonly exit?: (code: number) => void;
  /** How long to wait for the host to answer a request. Defaults to 30 seconds. */
  readonly requestTimeoutMs?: number;
}

/** A plugin ready to run. */
export interface Plugin {
  readonly id: string;
  /**
   * Speak protocol v1 until the host sends `rim.shutdown` or closes the input.
   * On stdio, `console.log` and friends are sent to stderr, because stdout
   * carries frames. Resolves after `onShutdown` has run.
   */
  run(options?: RunOptions): Promise<void>;
}

/** What `run()` needs from where the plugin runs: Node, or a browser frame. */
export interface Platform {
  /** The process's stdin and stdout; throws where there are none. */
  streams(): { input: AsyncIterable<Uint8Array | string>; output: FrameSink };
  /**
   * Called when the plugin talks over the process's own stdio: keep stdout for
   * frames, and say how the process exits when the connection ends.
   */
  claimStdio(): (code: number) => void;
  /** Read a manifest file; `undefined` when it does not exist or there are no files. */
  readManifest(path: string): ManifestInfo | undefined;
  /** Write a line where a person can see it, once the host cannot. */
  stderr(line: string): void;
}

/** A transport that can wait until what it sent has left. */
interface FlushableTransport extends Transport {
  flush?(): Promise<void>;
}

/**
 * Define a plugin.
 *
 * @example
 * definePlugin({
 *   id: "dev.example.hello",
 *   commands: {
 *     greet: { run: ({ invoker }) => ({ payload: `Hello, ${invoker?.displayName ?? "world"}!` }) },
 *   },
 * }).run();
 */
export function createDefinePlugin(platform: Platform): (definition: PluginDefinition) => Plugin {
  return (definition) => definePluginOn(platform, definition);
}

function definePluginOn(platform: Platform, definition: PluginDefinition): Plugin {
  if (typeof definition.id !== "string" || definition.id.length === 0) {
    throw new TypeError("definePlugin: id must be the plugin_id from rim-plugin.json");
  }
  const commands = new Map<string, CommandDefinition>();
  for (const [id, command] of Object.entries(definition.commands ?? {})) {
    if (typeof command?.run !== "function") {
      throw new TypeError(`definePlugin: command ${id} needs a run function`);
    }
    commands.set(id, command);
  }
  return Object.freeze({
    id: definition.id,
    run: (options: RunOptions = {}) => runPlugin(platform, definition, commands, options),
  });
}

async function runPlugin(
  platform: Platform,
  definition: PluginDefinition,
  commands: ReadonlyMap<string, CommandDefinition>,
  options: RunOptions,
): Promise<void> {
  const port = (globalThis as { rimPluginPort?: PortLike }).rimPluginPort;
  const onStreams = options.input === undefined && options.output === undefined;
  let transport: FlushableTransport;
  let exit = options.exit;
  if (options.transport) {
    transport = options.transport;
  } else if (port && onStreams) {
    transport = portTransport(port);
  } else {
    const streams =
      options.input === undefined || options.output === undefined ? platform.streams() : undefined;
    transport = streamTransport(
      options.input ?? (streams as NonNullable<typeof streams>).input,
      options.output ?? (streams as NonNullable<typeof streams>).output,
    );
    if (onStreams) exit ??= platform.claimStdio();
  }

  const session = new Session(
    definition,
    commands,
    (text) => transport.send(text),
    loadManifest(platform, options.manifestPath),
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    platform,
  );
  let code = 0;
  try {
    for await (const text of transport.messages) {
      session.receiveText(text);
      if (session.stopping) break;
    }
  } catch (error) {
    session.log("error", `connection failed: ${error instanceof Error ? error.message : error}`);
    code = error instanceof FrameTooLargeError ? 1 : 2;
  }
  await session.close();
  await transport.flush?.();
  transport.close();
  exit?.(code);
}

interface LoadedManifest {
  manifest?: ManifestInfo;
  problem?: string;
}

function loadManifest(platform: Platform, path: string | false | undefined): LoadedManifest {
  if (path === false) return {};
  const text = (globalThis as { rimPluginManifest?: unknown }).rimPluginManifest;
  const source = path ?? (typeof text === "string" ? "rimPluginManifest" : "rim-plugin.json");
  try {
    if (path === undefined && typeof text === "string") {
      return { manifest: parseManifestInfo(text, source) };
    }
    return { manifest: platform.readManifest(source) };
  } catch (error) {
    return {
      problem: `cannot read ${source}: ${error instanceof Error ? error.message : error}`,
    };
  }
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ExecuteParams {
  commandId: string;
  args: Readonly<Record<string, unknown>>;
  invoker: Principal | null;
  initiator: Initiator;
  confirmed: boolean;
}

/** One connection to the host. */
class Session {
  stopping = false;
  readonly host: Host;

  private readonly definition: PluginDefinition;
  private readonly commands: ReadonlyMap<string, CommandDefinition>;
  private readonly send: (text: string) => void;
  private readonly platform: Platform;
  private readonly manifest: ManifestInfo | undefined;
  private readonly manifestProblem: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private ready = false;
  private closed = false;
  private hostVersion = "";
  private protocolVersion = PROTOCOL_VERSION;
  private grantedCapabilities: readonly string[] = Object.freeze([]);
  private principal: Principal | null = null;

  constructor(
    definition: PluginDefinition,
    commands: ReadonlyMap<string, CommandDefinition>,
    send: (text: string) => void,
    loaded: LoadedManifest,
    requestTimeoutMs: number,
    platform: Platform,
  ) {
    this.definition = definition;
    this.commands = commands;
    this.send = send;
    this.platform = platform;
    this.manifest = loaded.manifest;
    this.requestTimeoutMs = requestTimeoutMs;
    this.manifestProblem =
      loaded.problem ??
      (loaded.manifest && loaded.manifest.pluginId !== definition.id
        ? `rim-plugin.json declares ${loaded.manifest.pluginId}, but the code defines ${definition.id}`
        : undefined);
    this.host = this.createHost();

    if (this.manifestProblem) this.log("error", this.manifestProblem);
    for (const id of this.manifest?.commands.keys() ?? []) {
      if (!commands.has(id))
        this.log("warn", `rim-plugin.json declares command ${id}, which has no handler`);
    }
    for (const id of commands.keys()) {
      if (this.manifest && !this.manifest.commands.has(id)) {
        this.log("warn", `command ${id} is not in rim-plugin.json, so the host never runs it`);
      }
    }
  }

  /** Handle the JSON text of one message from the host. */
  receiveText(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      this.log("warn", "dropped a message that is not JSON");
      return;
    }
    this.receive(frame);
  }

  /** Handle one parsed message from the host. */
  receive(frame: unknown): void {
    if (!isRecord(frame) || frame.jsonrpc !== "2.0") {
      this.log("warn", "dropped a frame that is not JSON-RPC 2.0");
      return;
    }
    const { method, id } = frame;
    if (typeof method === "string") {
      if (id === undefined || id === null) this.onNotification(method, frame.params);
      else if (isId(id)) void this.onRequest(method, frame.params, id);
      else this.log("warn", `dropped ${method}: its id is neither a number nor a string`);
      return;
    }
    if (isId(id) && ("result" in frame || "error" in frame)) {
      this.onResponse(id, frame);
      return;
    }
    this.log("warn", "dropped a frame that is neither a request, a notification nor a response");
  }

  /** Write a line to the host log, or to stderr once the connection is closed. */
  log(level: LogLevel, message: string): void {
    const frame: wire.LogRequest = {
      jsonrpc: "2.0",
      method: Method.log,
      params: { level, message },
    };
    if (!this.closed) {
      try {
        this.write(frame);
        return;
      } catch {
        // Too large for a frame: fall through to stderr.
      }
    }
    this.platform.stderr(`[${level}] ${message}`);
  }

  /** Run `onShutdown` and fail every request still waiting for the host. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.stopping = true;
    await this.callHook("onShutdown", () => this.definition.onShutdown?.());
    this.closed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(
        new HostRequestError(entry.method, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "the connection to the host closed",
        }),
      );
      this.pending.delete(id);
    }
  }

  private async onRequest(method: string, params: unknown, id: wire.Id): Promise<void> {
    try {
      switch (method) {
        case Method.handshake: {
          const result = this.handshake(params);
          const response: wire.HandshakeResponse = { jsonrpc: "2.0", id, result };
          this.write(response);
          if (result.accepted) {
            await this.callHook("onReady", () => this.definition.onReady?.(this.host));
          }
          return;
        }
        case Method.heartbeat: {
          const response: wire.HeartbeatResponse = { jsonrpc: "2.0", id, result: { pong: true } };
          this.write(response);
          return;
        }
        case Method.commandExecute: {
          let response: wire.CommandExecuteResponse | wire.ErrorResponse;
          try {
            response = { jsonrpc: "2.0", id, result: await this.execute(params) };
          } catch (error) {
            response = { jsonrpc: "2.0", id, error: toWireError(error, ErrorCode.PLUGIN_ERROR) };
          }
          this.writeAnswer(response);
          return;
        }
        default:
          this.writeError(id, ErrorCode.METHOD_NOT_FOUND, `method not found: ${method}`);
      }
    } catch (error) {
      this.writeError(
        id,
        ErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private onNotification(method: string, params: unknown): void {
    if (method === Method.shutdown) {
      this.stopping = true;
    } else if (method === Method.principalChanged) {
      this.onPrincipalChanged(params);
    } else if (method === Method.principalsRemapped) {
      this.onPrincipalsRemapped(params);
    }
    // Any other notification is ignored: v1 may add new ones.
  }

  private onResponse(id: wire.Id, frame: Record<string, unknown>): void {
    const entry = typeof id === "number" ? this.pending.get(id) : undefined;
    if (!entry) return;
    this.pending.delete(id as number);
    clearTimeout(entry.timer);
    if (frame.error !== undefined)
      entry.reject(new HostRequestError(entry.method, readWireError(frame.error)));
    else entry.resolve(frame.result);
  }

  private handshake(params: unknown): wire.HandshakeResult {
    const p = isRecord(params) ? params : {};
    const refuse = (error: string): wire.HandshakeResult => {
      this.log("error", `refused the handshake: ${error}`);
      return {
        accepted: false,
        protocolVersion: SUPPORTED_VERSIONS[0],
        pluginId: this.definition.id,
        error,
      };
    };
    if (this.manifestProblem) return refuse(this.manifestProblem);
    if (p.pluginId !== this.definition.id) {
      return refuse(
        `this plugin is ${this.definition.id}, but the host started it as ${String(p.pluginId)}`,
      );
    }
    const hostVersions = Array.isArray(p.supportedVersions)
      ? p.supportedVersions.filter(isVersion)
      : isVersion(p.protocolVersion)
        ? [p.protocolVersion]
        : [];
    const version = SUPPORTED_VERSIONS.find((v) => hostVersions.includes(v));
    if (version === undefined) {
      return refuse(
        `the host speaks protocol ${hostVersions.join(", ") || "(none)"}, this plugin speaks ${SUPPORTED_VERSIONS.join(", ")}`,
      );
    }

    let principal: Principal | null = null;
    try {
      principal = readPrincipal(p.principal ?? null);
    } catch (error) {
      this.log("warn", `ignored the handshake principal: ${(error as Error).message}`);
    }
    this.principal = principal;
    this.protocolVersion = version;
    this.hostVersion = typeof p.hostVersion === "string" ? p.hostVersion : "";
    this.grantedCapabilities = Object.freeze(
      Array.isArray(p.grantedCapabilities)
        ? p.grantedCapabilities.filter((c): c is string => typeof c === "string")
        : [],
    );
    this.ready = true;
    return { accepted: true, protocolVersion: version, pluginId: this.definition.id };
  }

  private async execute(params: unknown): Promise<wire.CommandResult> {
    if (!this.ready) {
      throw new PluginError("rim.command.execute arrived before the handshake", {
        code: ErrorCode.INVALID_REQUEST,
      });
    }
    const p = readExecuteParams(params);
    const command = this.commands.get(p.commandId);
    if (!command) {
      throw new PluginError(`unknown command: ${p.commandId}`, { code: ErrorCode.INVALID_PARAMS });
    }
    const dangerous =
      command.dangerous === true || this.manifest?.commands.get(p.commandId) === true;
    // The host never sends an unconfirmed dangerous command and never lets the
    // agent confirm one. Check anyway, so a host bug cannot run one.
    if (dangerous && !(p.confirmed === true && p.initiator === "user")) {
      throw new PluginError(
        `${p.commandId} is dangerous and runs only after the user confirms it`,
        {
          code: ErrorCode.PLUGIN_ERROR,
          data: { reason: "confirmation_required" },
        },
      );
    }
    const context: CommandContext = Object.freeze({ ...p, host: this.host });
    return toCommandResult(p.commandId, await command.run(context));
  }

  private onPrincipalChanged(params: unknown): void {
    let principal: Principal | null;
    try {
      principal = readPrincipal(isRecord(params) ? params.principal : undefined);
    } catch (error) {
      this.log("warn", `ignored rim.principal.changed: ${(error as Error).message}`);
      return;
    }
    if (samePrincipal(principal, this.principal)) return;
    this.principal = principal;
    void this.callHook("onPrincipalChanged", () =>
      this.definition.onPrincipalChanged?.(principal, this.host),
    );
  }

  private onPrincipalsRemapped(params: unknown): void {
    let mappings: readonly PrincipalMapping[];
    try {
      mappings = readPrincipalMappings(isRecord(params) ? params.mappings : undefined);
    } catch (error) {
      this.log("warn", `ignored rim.principals.remapped: ${(error as Error).message}`);
      return;
    }
    if (mappings.length === 0) return;
    void this.callHook("onPrincipalsRemapped", () =>
      this.definition.onPrincipalsRemapped?.(mappings, this.host),
    );
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed || this.stopping || !this.ready) {
      const message = this.ready
        ? "the connection to the host is closing"
        : "the handshake has not finished";
      return Promise.reject(
        new HostRequestError(method, { code: ErrorCode.INTERNAL_ERROR, message }),
      );
    }
    const id = this.nextRequestId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HostRequestError(method, {
            code: ErrorCode.INTERNAL_ERROR,
            message: `the host did not answer within ${this.requestTimeoutMs} ms`,
          }),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve: resolvePromise, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private async updatePanel(panelId: string, state: unknown, patch: boolean): Promise<void> {
    if (this.manifest && !this.manifest.panelIds.has(panelId)) {
      throw new PluginError(`panel ${panelId} is not declared in rim-plugin.json`, {
        code: ErrorCode.INVALID_PARAMS,
      });
    }
    await this.request(UPDATE_PANEL_METHOD, { panel_id: panelId, state, patch });
  }

  private createHost(): Host {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const session = this;
    return Object.freeze({
      pluginId: this.definition.id,
      get hostVersion() {
        return session.hostVersion;
      },
      get protocolVersion() {
        return session.protocolVersion;
      },
      get grantedCapabilities() {
        return session.grantedCapabilities;
      },
      get principal() {
        return session.principal;
      },
      log: Object.freeze({
        debug: (message: string) => session.log("debug", message),
        info: (message: string) => session.log("info", message),
        warn: (message: string) => session.log("warn", message),
        error: (message: string) => session.log("error", message),
      }),
      storage: Object.freeze({
        get: async (key: string) => {
          const result = await session.request(STORAGE_GET_METHOD, { key });
          return isRecord(result) && "value" in result ? result.value : null;
        },
        set: async (key: string, value: unknown) => {
          await session.request(STORAGE_SET_METHOD, { key, value });
        },
      }),
      chat: Object.freeze({
        listMessages: async (conversationId: string, options = {}) =>
          (await session.request(CHAT_LIST_MESSAGES_METHOD, {
            conversationId,
            ...options,
          })) as ChatMessagePage,
        getMessage: async (messageId: string) => {
          const result = await session.request(CHAT_GET_MESSAGE_METHOD, { messageId });
          return isRecord(result) && isRecord(result.message)
            ? (result.message as unknown as ChatMessage)
            : null;
        },
        searchMessages: async (query: string, options = {}) => {
          const result = await session.request(CHAT_SEARCH_MESSAGES_METHOD, {
            query,
            ...options,
          });
          return isRecord(result) && Array.isArray(result.messages)
            ? (result.messages as ChatMessage[])
            : [];
        },
        postMessage: async (conversationId: string, body: string, options = {}) =>
          (await session.request(CHAT_POST_MESSAGE_METHOD, {
            conversationId,
            body,
            ...options,
          })) as { id: string },
      } satisfies Chat),
      panels: Object.freeze({
        set: (panelId: string, state: unknown) => session.updatePanel(panelId, state, false),
        patch: (panelId: string, patch: Readonly<Record<string, unknown>>) => {
          if (!isRecord(patch)) {
            return Promise.reject(new TypeError("panels.patch: patch must be an object"));
          }
          return session.updatePanel(panelId, patch, true);
        },
      }),
    });
  }

  private async callHook(name: string, hook: () => void | Promise<void>): Promise<void> {
    try {
      await hook();
    } catch (error) {
      this.log("error", `${name} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private write(frame: object): void {
    const text = JSON.stringify(frame);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_FRAME_BYTES) throw new FrameTooLargeError(bytes);
    this.send(text);
  }

  /** Write a response, or an error saying why it could not be sent. */
  private writeAnswer(response: wire.CommandExecuteResponse | wire.ErrorResponse): void {
    try {
      this.write(response);
    } catch (error) {
      this.writeError(
        response.id,
        ErrorCode.INTERNAL_ERROR,
        `could not send the result: ${(error as Error).message}`,
      );
    }
  }

  private writeError(id: wire.Id, code: number, message: string): void {
    const response: wire.ErrorResponse = { jsonrpc: "2.0", id, error: { code, message } };
    this.write(response);
  }
}

function readExecuteParams(params: unknown): ExecuteParams {
  const invalid = (why: string) =>
    new PluginError(`invalid rim.command.execute params: ${why}`, {
      code: ErrorCode.INVALID_PARAMS,
    });
  if (!isRecord(params)) throw invalid("params must be an object");
  const { commandId, args, invoker, initiator, confirmed } = params;
  if (typeof commandId !== "string" || commandId.length === 0)
    throw invalid("commandId must be a string");
  if (args !== undefined && !isRecord(args)) throw invalid("args must be an object");
  if (initiator !== "user" && initiator !== "agent")
    throw invalid("initiator must be user or agent");
  if (typeof confirmed !== "boolean") throw invalid("confirmed must be a boolean");
  let principal: Principal | null;
  try {
    principal = readPrincipal(invoker ?? null);
  } catch (error) {
    throw invalid((error as Error).message);
  }
  return {
    commandId,
    args: Object.freeze({ ...(args ?? {}) }),
    invoker: principal,
    initiator,
    confirmed,
  };
}

function toCommandResult(commandId: string, output: CommandOutput | void): wire.CommandResult {
  if (output === undefined || output === null) return {};
  if (typeof output !== "object" || Array.isArray(output)) {
    throw new PluginError(
      `command ${commandId} returned a ${typeof output}; return { payload, message }`,
      {
        code: ErrorCode.INTERNAL_ERROR,
      },
    );
  }
  const result: wire.CommandResult = {};
  if (output.payload !== undefined) result.payload = output.payload;
  if (output.message !== undefined) {
    if (typeof output.message !== "string") {
      throw new PluginError(`command ${commandId} returned a message that is not a string`, {
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
    result.message = output.message;
  }
  return result;
}

function readWireError(value: unknown): wire.Error {
  if (isRecord(value) && typeof value.code === "number" && typeof value.message === "string") {
    return { code: value.code, message: value.message, data: value.data };
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: "the host sent a malformed error" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is wire.Id {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
