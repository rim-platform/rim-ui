// One protocol v1 connection to a web plugin, over the MessagePort the host
// transferred to its frame: one JSON-RPC message per postMessage, as a string
// of JSON text. The session does the handshake, heartbeats, the plugin's own
// calls (behind capabilities and limits) and shutdown. It touches no DOM, so it
// runs in Node against a real MessageChannel.

import { isChatMethod } from "../chat/chatTypes";
import {
  ErrorCode,
  MAX_MESSAGE_BYTES,
  METHOD_CAPABILITY,
  Method,
  PROTOCOL_VERSION,
  RpcError,
  SUPPORTED_VERSIONS,
  isRpcId,
  utf8Length,
  type JsonRpcId,
  type Principal,
  type PrincipalMapping,
} from "./rpc";

export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
export const COMMAND_TIMEOUT_MS = 30_000;
export const SHUTDOWN_GRACE_MS = 1_000;
/** Missed heartbeats in a row after which the frame is removed. */
export const MAX_MISSED_HEARTBEATS = 2;
/** Plugin requests and notifications a minute; past it requests get RATE_LIMITED. */
export const MESSAGES_PER_MINUTE = 600;
/** Messages of any kind a minute past which the plugin is stopped. */
export const FLOOD_PER_MINUTE = 1_200;
/** Calls a minute per capability, and for `rim.storage.*`. */
export const CALLS_PER_MINUTE = 120;
/** `rim.log` lines a minute the host keeps. */
export const LOG_LINES_PER_MINUTE = 120;
const MINUTE_MS = 60_000;

/** The port end the host keeps. */
export interface SessionPort {
  postMessage(message: string): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];

/** What the host does for the plugin. Each may throw an {@link RpcError}. */
export interface SessionHooks {
  log(level: LogLevel, message: string): void;
  updatePanel(panelId: string, state: unknown, patch: boolean): unknown;
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<void>;
  /**
   * The plugin's settings for the signed-in account, for `rim.settings.get` and
   * `rim.settings.changed`. Throws an {@link RpcError} with `data.reason`
   * `"secretsLocked"` when a saved secret cannot be read.
   */
  settingsGet(): Promise<Record<string, unknown>>;
  /** A `rim.chat.*` call, already past the capability gate and its rate limit. */
  chat?(method: string, params: unknown): Promise<unknown>;
  /** The session ended on its own: a failed handshake, a flood, missed heartbeats. */
  stopped(reason: string): void;
}

export interface SessionConfig {
  pluginId: string;
  hostVersion: string;
  grantedCapabilities: readonly string[];
  principal: Principal | null;
  mappings: readonly PrincipalMapping[];
  /** True while the page is hidden; browsers throttle background timers then. */
  isHidden: () => boolean;
  now?: () => number;
}

/** What a command returns. */
export interface CommandOutput {
  payload: unknown;
  message?: string;
}

export interface ExecuteParams {
  commandId: string;
  args: Record<string, unknown>;
  invoker: Principal | null;
  initiator: "user" | "agent";
  confirmed: boolean;
}

/** The connection is closed or closing, so the request was not sent or answered. */
export class SessionClosedError extends Error {
  constructor() {
    super("the plugin is not running");
    this.name = "SessionClosedError";
  }
}

/** The plugin did not answer in time. */
export class SessionTimeoutError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`the plugin did not answer within ${ms / 1000}s`);
    this.name = "SessionTimeoutError";
    this.ms = ms;
  }
}

/** The plugin answered a command with something other than an object. */
export class InvalidResultError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidResultError";
  }
}

/** Counts events in fixed one-minute windows. */
class Window {
  private count = 0;
  private start: number;
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
    this.start = now();
  }

  /** Count one event; false when it is over `limit` this minute. */
  take(limit: number): boolean {
    const now = this.now();
    if (now - this.start >= MINUTE_MS) {
      this.count = 0;
      this.start = now;
    }
    this.count += 1;
    return this.count <= limit;
  }

  /** True when the last event was the first one over `limit` this minute. */
  firstOver(limit: number): boolean {
    return this.count === limit + 1;
  }
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type State = "new" | "handshaking" | "running" | "stopping" | "closed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePrincipal(a: Principal | null, b: Principal | null): boolean {
  return a?.principalId === b?.principalId && a?.displayName === b?.displayName;
}

export class PluginSession {
  private state: State = "new";
  private readonly port: SessionPort;
  private readonly config: SessionConfig;
  private readonly hooks: SessionHooks;
  private readonly now: () => number;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private nextId = 1;
  private nextHeartbeat = -1;
  private missedHeartbeats = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private principal: Principal | null;
  private sentPrincipal: Principal | null;
  private mappings: readonly PrincipalMapping[];
  private readonly traffic: Window;
  private readonly messages: Window;
  private readonly logLines: Window;
  private readonly capabilityCalls = new Map<string, Window>();
  /** The settings reads, each started after the one before has been sent. */
  private settingsQueue: Promise<void> = Promise.resolve();

  constructor(port: SessionPort, config: SessionConfig, hooks: SessionHooks) {
    this.port = port;
    this.config = config;
    this.hooks = hooks;
    this.now = config.now ?? Date.now;
    this.principal = config.principal;
    this.sentPrincipal = config.principal;
    this.mappings = config.mappings;
    this.traffic = new Window(this.now);
    this.messages = new Window(this.now);
    this.logLines = new Window(this.now);
    this.port.onmessage = (event) => this.receive(event.data);
  }

  get running(): boolean {
    return this.state === "running";
  }

  /** Send `rim.handshake`; resolves once the plugin accepted it, else rejects with why. */
  async handshake(): Promise<void> {
    if (this.state !== "new") throw new Error("the handshake was already sent");
    this.state = "handshaking";
    let result: unknown;
    try {
      result = await this.request(
        Method.handshake,
        {
          protocolVersion: PROTOCOL_VERSION,
          supportedVersions: [...SUPPORTED_VERSIONS],
          pluginId: this.config.pluginId,
          hostVersion: this.config.hostVersion,
          grantedCapabilities: [...this.config.grantedCapabilities],
          principal: this.principal,
        },
        HANDSHAKE_TIMEOUT_MS,
      );
    } catch (error) {
      const reason =
        error instanceof SessionTimeoutError
          ? "the plugin did not answer the handshake within 10s"
          : `the handshake failed: ${(error as Error).message}`;
      this.fail(reason);
      throw new Error(reason, { cause: error });
    }
    const problem = this.checkHandshake(result);
    if (problem) {
      this.fail(problem);
      throw new Error(problem);
    }
    if (this.state !== "handshaking") throw new SessionClosedError();
    this.state = "running";
    if (!samePrincipal(this.principal, this.sentPrincipal)) this.sendPrincipal();
    if (this.mappings.length > 0)
      this.notify(Method.principalsRemapped, { mappings: this.mappings });
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private checkHandshake(result: unknown): string | null {
    if (
      !isRecord(result) ||
      typeof result.accepted !== "boolean" ||
      typeof result.protocolVersion !== "number" ||
      typeof result.pluginId !== "string"
    ) {
      return "the plugin answered the handshake with an invalid result";
    }
    if (!result.accepted) {
      const why = typeof result.error === "string" ? result.error : "unknown reason";
      return `the plugin refused the handshake: ${why}`;
    }
    if (!SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
      return `the plugin chose protocol ${result.protocolVersion}, which this host does not speak`;
    }
    if (result.pluginId !== this.config.pluginId) {
      return `the plugin answered as ${result.pluginId}, not ${this.config.pluginId}`;
    }
    return null;
  }

  /** Run one manifest command; the host's gates already passed. */
  async execute(params: ExecuteParams, timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandOutput> {
    if (this.state !== "running") throw new SessionClosedError();
    const result = await this.request(Method.commandExecute, params, timeoutMs);
    if (!isRecord(result)) {
      throw new InvalidResultError("expected an object with a `payload` field");
    }
    if (result.message !== undefined && typeof result.message !== "string") {
      throw new InvalidResultError("`message` must be a string");
    }
    return {
      payload: result.payload ?? null,
      ...(typeof result.message === "string" ? { message: result.message } : {}),
    };
  }

  /** The signed-in user changed; a running plugin hears it at once, a starting one after its handshake. */
  setPrincipal(principal: Principal | null): void {
    this.principal = principal;
    if (this.state === "running" && !samePrincipal(principal, this.sentPrincipal)) {
      this.sendPrincipal();
    }
  }

  /**
   * The plugin's settings changed: a running plugin gets them in
   * `rim.settings.changed` once they are read, and none while they cannot be.
   */
  settingsChanged(): void {
    if (this.state !== "running") return;
    this.queueSettings(
      (values) => this.notify(Method.settingsChanged, { values }),
      (error) => this.hooks.log("warn", `settings not sent: ${error.message}`),
    );
  }

  /** The whole provisional-to-key mapping this host knows. */
  setMappings(mappings: readonly PrincipalMapping[]): void {
    if (JSON.stringify(mappings) === JSON.stringify(this.mappings)) return;
    this.mappings = mappings;
    if (this.state === "running" && mappings.length > 0) {
      this.notify(Method.principalsRemapped, { mappings });
    }
  }

  /**
   * Send `rim.shutdown`, keep answering the plugin's requests for the grace
   * period, then close the port.
   */
  async shutdown(graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
    if (this.state === "closed" || this.state === "stopping") return;
    const handshook = this.state === "running";
    this.state = "stopping";
    this.stopHeartbeats();
    this.rejectPending();
    if (handshook) this.write({ jsonrpc: "2.0", method: Method.shutdown });
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    this.close();
  }

  /** Close the port now, without a word to the plugin. */
  close(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.stopHeartbeats();
    this.rejectPending();
    this.port.onmessage = null;
    this.port.close();
  }

  private sendPrincipal(): void {
    this.sentPrincipal = this.principal;
    this.notify(Method.principalChanged, { principal: this.principal });
    // The settings belong to the signed-in account, so they follow every principal change.
    this.settingsChanged();
  }

  /**
   * Read the plugin's settings once every read queued before has been sent, and
   * hand them to `deliver`, or why they could not be read to `failed`. One read
   * at a time, each sent before the next starts, so the plugin never gets an
   * older set after a newer one.
   */
  private queueSettings(
    deliver: (values: Record<string, unknown>) => void,
    failed: (error: RpcError) => void,
  ): void {
    this.settingsQueue = this.settingsQueue.then(async () => {
      let values: Record<string, unknown>;
      try {
        values = await this.hooks.settingsGet();
      } catch (error) {
        failed(asRpcError(error));
        return;
      }
      try {
        deliver(values);
      } catch (error) {
        if (!(error instanceof SessionClosedError)) {
          this.hooks.log("warn", `settings not sent: ${(error as Error).message}`);
        }
      }
    });
  }

  private fail(reason: string): void {
    if (this.state === "closed") return;
    this.close();
    this.hooks.stopped(reason);
  }

  private stopHeartbeats(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private rejectPending(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new SessionClosedError());
      this.pending.delete(id);
    }
  }

  /**
   * Send one `rim.heartbeat` unless the page is hidden. Two missed in a row stop
   * the plugin; the interval calls it every 30 seconds.
   */
  heartbeat(): Promise<void> {
    if (this.state !== "running" || this.config.isHidden()) return Promise.resolve();
    const id = this.nextHeartbeat--;
    return this.request(Method.heartbeat, undefined, HEARTBEAT_TIMEOUT_MS, id).then(
      () => {
        this.missedHeartbeats = 0;
      },
      (error: unknown) => {
        if (!(error instanceof SessionTimeoutError)) return;
        this.missedHeartbeats += 1;
        if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          this.fail("the plugin is not responding");
        }
      },
    );
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number,
    id: JsonRpcId = this.nextId++,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SessionTimeoutError(timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write(
          params === undefined
            ? { jsonrpc: "2.0", id, method }
            : { jsonrpc: "2.0", id, method, params },
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.state !== "running") return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: object): void {
    if (this.state === "closed") throw new SessionClosedError();
    const text = JSON.stringify(message);
    if (utf8Length(text) > MAX_MESSAGE_BYTES) {
      throw new RpcError(ErrorCode.INTERNAL_ERROR, "the message is over 4 MiB");
    }
    this.port.postMessage(text);
  }

  private answer(id: JsonRpcId, result: unknown): void {
    if (this.state === "closed") return;
    try {
      this.write({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (error instanceof SessionClosedError) return;
      this.answerError(id, new RpcError(ErrorCode.INTERNAL_ERROR, (error as Error).message));
    }
  }

  private answerError(id: JsonRpcId, error: RpcError): void {
    if (this.state === "closed") return;
    this.write({ jsonrpc: "2.0", id, error: error.toBody() });
  }

  private receive(data: unknown): void {
    if (this.state === "closed") return;
    if (!this.traffic.take(FLOOD_PER_MINUTE)) {
      this.fail("the plugin flooded the host with messages");
      return;
    }
    if (typeof data !== "string") {
      this.hooks.log("warn", "dropped a message that is not a string of JSON");
      return;
    }
    if (utf8Length(data) > MAX_MESSAGE_BYTES) {
      this.fail("the plugin sent a message over 4 MiB");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      this.hooks.log("warn", "dropped a message that is not JSON");
      return;
    }
    if (!isRecord(message) || message.jsonrpc !== "2.0") {
      this.hooks.log("warn", "dropped a message that is not JSON-RPC 2.0");
      return;
    }
    const { method, id } = message;
    if (typeof method === "string") {
      if (id === undefined || id === null) this.onNotification(method, message.params);
      else if (isRpcId(id)) void this.onRequest(method, message.params, id);
      else this.hooks.log("warn", `dropped ${method}: its id is neither a number nor a string`);
      return;
    }
    if (isRpcId(id) && ("result" in message || "error" in message)) {
      this.onResponse(id, message);
      return;
    }
    this.hooks.log(
      "warn",
      "dropped a message that is neither a request, a notification nor a response",
    );
  }

  private onResponse(id: JsonRpcId, message: Record<string, unknown>): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    const error = message.error;
    if (error !== undefined) {
      const body = isRecord(error) ? error : {};
      entry.reject(
        new RpcError(
          typeof body.code === "number" ? body.code : ErrorCode.INTERNAL_ERROR,
          typeof body.message === "string" ? body.message : "the plugin sent a malformed error",
          body.data,
        ),
      );
    } else {
      entry.resolve(message.result);
    }
  }

  /** The capability check and rate limits every plugin call passes; null when it may go on. */
  private gate(method: string): RpcError | null {
    if (!this.messages.take(MESSAGES_PER_MINUTE)) {
      return new RpcError(ErrorCode.RATE_LIMITED, "rate limit exceeded: too many messages");
    }
    const capability = METHOD_CAPABILITY[method];
    if (capability && !this.config.grantedCapabilities.includes(capability)) {
      return new RpcError(ErrorCode.CAPABILITY_DENIED, `capability denied: ${capability}`);
    }
    const bucket =
      capability ??
      (method === Method.storageGet || method === Method.storageSet ? "storage" : null);
    if (bucket) {
      let window = this.capabilityCalls.get(bucket);
      if (!window) {
        window = new Window(this.now);
        this.capabilityCalls.set(bucket, window);
      }
      if (!window.take(CALLS_PER_MINUTE)) {
        return new RpcError(
          ErrorCode.RATE_LIMITED,
          `rate limit exceeded for capability: ${bucket}`,
        );
      }
    }
    return null;
  }

  private onNotification(method: string, params: unknown): void {
    if (this.gate(method)) return;
    if (method === Method.log) {
      try {
        this.log(params);
      } catch {
        // A malformed log notification gets no answer.
      }
    }
    // No other plugin notification exists in v1; unknown ones are ignored.
  }

  private async onRequest(method: string, params: unknown, id: JsonRpcId): Promise<void> {
    const denied = this.gate(method);
    if (denied) {
      this.answerError(id, denied);
      return;
    }
    if (method === Method.settingsGet) {
      // Answered in turn with `rim.settings.changed`; its params are ignored.
      this.queueSettings(
        (values) => this.answer(id, { values }),
        (error) => this.answerError(id, error),
      );
      return;
    }
    try {
      this.answer(id, await this.dispatch(method, params));
    } catch (error) {
      this.answerError(id, asRpcError(error));
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case Method.log:
        this.log(params);
        return { ok: true };
      case Method.updatePanel: {
        const p = isRecord(params) ? params : {};
        if (typeof p.panel_id !== "string") {
          throw new RpcError(ErrorCode.INVALID_PARAMS, "missing required param: panel_id");
        }
        if (!("state" in p))
          throw new RpcError(ErrorCode.INVALID_PARAMS, "missing required param: state");
        return this.hooks.updatePanel(p.panel_id, p.state, p.patch === true);
      }
      case Method.storageGet: {
        const key = storageKey(params);
        return { value: (await this.hooks.storageGet(key)) ?? null };
      }
      case Method.storageSet: {
        const key = storageKey(params);
        const p = params as Record<string, unknown>;
        if (!("value" in p))
          throw new RpcError(ErrorCode.INVALID_PARAMS, "missing required param: value");
        await this.hooks.storageSet(key, p.value);
        return { ok: true };
      }
      default:
        if (isChatMethod(method) && this.hooks.chat) return this.hooks.chat(method, params);
        throw new RpcError(ErrorCode.METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  private log(params: unknown): void {
    const p = isRecord(params) ? params : {};
    if (
      typeof p.level !== "string" ||
      !LOG_LEVELS.includes(p.level) ||
      typeof p.message !== "string"
    ) {
      throw new RpcError(ErrorCode.INVALID_PARAMS, "invalid rim.log params");
    }
    if (this.logLines.take(LOG_LINES_PER_MINUTE)) {
      this.hooks.log(p.level as LogLevel, p.message);
    } else if (this.logLines.firstOver(LOG_LINES_PER_MINUTE)) {
      this.hooks.log(
        "warn",
        `more than ${LOG_LINES_PER_MINUTE} log lines this minute; dropping the rest`,
      );
    }
  }
}

/** `error` as the JSON-RPC error a plugin gets: itself, or `INTERNAL_ERROR` with its message. */
function asRpcError(error: unknown): RpcError {
  return error instanceof RpcError
    ? error
    : new RpcError(ErrorCode.INTERNAL_ERROR, (error as Error).message ?? String(error));
}

function storageKey(params: unknown): string {
  const key = isRecord(params) ? params.key : undefined;
  if (typeof key !== "string")
    throw new RpcError(ErrorCode.INVALID_PARAMS, "missing required param: key");
  return key;
}
