/**
 * The client side of the Agent Client Protocol, version 1, over an {@link AcpConnection}: it
 * initializes the agent, opens sessions, sends prompts and turns the agent's `session/update`
 * notifications and `session/request_permission` requests into typed values. RIM offers the
 * agent no file system and no terminal: the agent works with its own tools and RIM shows what
 * it does. Everything parsed here came from the agent and is untrusted; fields that are missing
 * or of the wrong type are left out or given their protocol default.
 */

import type { AcpConnection, JsonValue } from "./acpConnection";

/** The protocol version RIM speaks. */
export const ACP_PROTOCOL_VERSION = 1;

/** How long `initialize`, `session/new`, `session/load` and `session/resume` may take. */
export const SETUP_TIMEOUT_MS = 60_000;

/** The version this bundle was built as. */
const CLIENT_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/** A content block in a message, a prompt or a tool call. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; uri: string | null }
  | { type: "audio"; mimeType: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      title: string | null;
      mimeType: string | null;
    }
  | { type: "resource"; uri: string; mimeType: string | null; text: string | null }
  | { type: "unknown" };

/** What kind of work a tool call does. */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/**
 * Where a tool call is. `cancelled` is RIM's own: a call that had not finished when the person
 * cancelled the turn.
 */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

/** What a tool call shows. */
export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

/** A file a tool call works on. */
export interface ToolCallLocation {
  path: string;
  /** The line, from 1, or `null`. */
  line: number | null;
}

/** A tool call, as the agent reported it so far. */
export interface ToolCall {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  /** What the tool was called with, as the agent sent it. */
  rawInput?: JsonValue;
  /** What the tool returned, as the agent sent it. */
  rawOutput?: JsonValue;
}

/** The fields of a tool call an update changes; the others keep their value. */
export type ToolCallPatch = Pick<ToolCall, "toolCallId"> & Partial<Omit<ToolCall, "toolCallId">>;

/** How important a plan entry is. */
export type PlanPriority = "high" | "medium" | "low";
/** Where a plan entry is. */
export type PlanEntryStatus = "pending" | "in_progress" | "completed";

/** One step of the agent's plan. */
export interface PlanEntry {
  content: string;
  priority: PlanPriority;
  status: PlanEntryStatus;
}

/** A mode the agent can work in. */
export interface SessionMode {
  id: string;
  name: string;
  description: string | null;
}

/** The modes of a session and the one it is in. */
export interface SessionModes {
  currentModeId: string;
  availableModes: SessionMode[];
}

/** A slash command the agent offers. */
export interface AgentCommand {
  name: string;
  description: string;
  /** What to write after the command, or `null`. */
  hint: string | null;
}

/** One `session/update`, by kind. A kind RIM does not know is kept as `unknown`. */
export type SessionUpdate =
  | { kind: "user_message_chunk"; content: ContentBlock; messageId: string | null }
  | { kind: "agent_message_chunk"; content: ContentBlock; messageId: string | null }
  | { kind: "agent_thought_chunk"; content: ContentBlock; messageId: string | null }
  | { kind: "tool_call"; toolCall: ToolCall }
  | { kind: "tool_call_update"; patch: ToolCallPatch }
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "available_commands_update"; commands: AgentCommand[] }
  | { kind: "current_mode_update"; currentModeId: string }
  | { kind: "session_info_update"; title: string | null }
  | { kind: "unknown" };

/** Why a turn ended. */
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/** What one permission option means; only a hint for how to show it. */
export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

/** One answer the agent offers to a permission request. */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/** A permission request from the agent. */
export interface PermissionRequest {
  sessionId: string;
  /** What the agent wants to do: the fields of the tool call it sent with the request. */
  toolCall: ToolCallPatch;
  options: PermissionOption[];
  /** Aborts when the request no longer needs an answer: the turn was cancelled or the agent withdrew it. */
  signal: AbortSignal;
}

/** The answer to a permission request. */
export type PermissionOutcome =
  { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

/** A way the agent offers to sign in. */
export interface AuthMethod {
  id: string;
  name: string;
  description: string | null;
  /** `agent`, `terminal`, `env_var` or another kind the agent names. */
  type: string;
}

/** What the agent said about itself in `initialize`. */
export interface AgentHello {
  protocolVersion: number;
  /** The agent's capabilities, as it sent them. */
  agentCapabilities: AgentCapabilities;
  agentInfo: { name: string; title: string | null; version: string | null } | null;
  authMethods: AuthMethod[];
}

/** The capabilities RIM reads, from the agent's own object. */
export interface AgentCapabilities {
  loadSession: boolean;
  /** Whether the agent can resume a session without replaying it. */
  resumeSession: boolean;
  mcpCapabilities: { http: boolean; sse: boolean };
  promptCapabilities: { image: boolean; audio: boolean; embeddedContext: boolean };
  /** The whole object as the agent sent it. */
  raw: JsonValue;
}

/** An MCP server reached over HTTP, handed to the agent for one session. */
export interface AcpHttpMcpServer {
  type: "http";
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

/** What opening or resuming a session needs. */
export interface SessionSetup {
  /** The session's working folder, a full path. */
  cwd: string;
  mcpServers: AcpHttpMcpServer[];
}

/** What an opened session has. */
export interface OpenedSession {
  sessionId: string;
  modes: SessionModes | null;
}

/** What the client hands its owner. */
export interface AcpClientHandlers {
  /** Hears each `session/update`. */
  onUpdate: (sessionId: string, update: SessionUpdate) => void;
  /**
   * Answers a permission request. Whatever it resolves, a request whose signal aborted is
   * answered `cancelled`, and so is an option the agent did not offer.
   */
  onPermission: (request: PermissionRequest) => Promise<PermissionOutcome>;
}

type JsonObject = { [key: string]: JsonValue };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(object: JsonObject, key: string): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function text(object: JsonObject, key: string): string | null {
  const value = field(object, key);
  return typeof value === "string" ? value : null;
}

function flag(object: JsonValue | undefined, key: string): boolean {
  return isObject(object) && field(object, key) === true;
}

function oneOf<T extends string>(value: JsonValue | undefined, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

const TOOL_KINDS: readonly ToolKind[] = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
];
const WIRE_TOOL_STATUSES: readonly ToolCallStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
];
const PRIORITIES: readonly PlanPriority[] = ["high", "medium", "low"];
const ENTRY_STATUSES: readonly PlanEntryStatus[] = ["pending", "in_progress", "completed"];
const STOP_REASONS: readonly StopReason[] = [
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
];
const OPTION_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
];

/**
 * Reads a content block.
 *
 * @returns The block, or `unknown` when it is not one RIM knows or lacks what it needs.
 */
export function parseContentBlock(value: JsonValue | undefined): ContentBlock {
  if (!isObject(value)) return { type: "unknown" };
  switch (field(value, "type")) {
    case "text": {
      const body = text(value, "text");
      return body === null ? { type: "unknown" } : { type: "text", text: body };
    }
    case "image": {
      const mimeType = text(value, "mimeType");
      return mimeType === null
        ? { type: "unknown" }
        : { type: "image", mimeType, uri: text(value, "uri") };
    }
    case "audio": {
      const mimeType = text(value, "mimeType");
      return mimeType === null ? { type: "unknown" } : { type: "audio", mimeType };
    }
    case "resource_link": {
      const uri = text(value, "uri");
      const name = text(value, "name");
      if (uri === null || name === null) return { type: "unknown" };
      return {
        type: "resource_link",
        uri,
        name,
        title: text(value, "title"),
        mimeType: text(value, "mimeType"),
      };
    }
    case "resource": {
      const resource = field(value, "resource");
      if (!isObject(resource)) return { type: "unknown" };
      const uri = text(resource, "uri");
      if (uri === null) return { type: "unknown" };
      return {
        type: "resource",
        uri,
        mimeType: text(resource, "mimeType"),
        text: text(resource, "text"),
      };
    }
    default:
      return { type: "unknown" };
  }
}

function parseToolContent(value: JsonValue): ToolCallContent | null {
  if (!isObject(value)) return null;
  switch (field(value, "type")) {
    case "content":
      return { type: "content", content: parseContentBlock(field(value, "content")) };
    case "diff": {
      const path = text(value, "path");
      const newText = text(value, "newText");
      if (path === null || newText === null) return null;
      return { type: "diff", path, oldText: text(value, "oldText"), newText };
    }
    case "terminal": {
      const terminalId = text(value, "terminalId");
      return terminalId === null ? null : { type: "terminal", terminalId };
    }
    default:
      return null;
  }
}

function parseLocation(value: JsonValue): ToolCallLocation | null {
  if (!isObject(value)) return null;
  const path = text(value, "path");
  if (path === null) return null;
  const line = field(value, "line");
  return {
    path,
    line: typeof line === "number" && Number.isInteger(line) && line >= 0 ? line : null,
  };
}

function list<T>(value: JsonValue | undefined, parse: (item: JsonValue) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed !== null) items.push(parsed);
  }
  return items;
}

/**
 * Reads the fields of a tool call that are present. Missing and `null` fields are left out, so
 * they keep their value when merged.
 *
 * @returns The patch, or `null` when there is no `toolCallId`.
 */
export function parseToolCallPatch(value: JsonValue | undefined): ToolCallPatch | null {
  if (!isObject(value)) return null;
  const toolCallId = text(value, "toolCallId");
  if (toolCallId === null || toolCallId === "") return null;
  const patch: ToolCallPatch = { toolCallId };
  const title = text(value, "title");
  if (title !== null) patch.title = title;
  const kind = field(value, "kind");
  if (kind !== undefined && kind !== null) patch.kind = oneOf(kind, TOOL_KINDS) ?? "other";
  const status = oneOf(field(value, "status"), WIRE_TOOL_STATUSES);
  if (status !== null) patch.status = status;
  const content = list(field(value, "content"), parseToolContent);
  if (content !== null) patch.content = content;
  const locations = list(field(value, "locations"), parseLocation);
  if (locations !== null) patch.locations = locations;
  const rawInput = field(value, "rawInput");
  if (rawInput !== undefined && rawInput !== null) patch.rawInput = rawInput;
  const rawOutput = field(value, "rawOutput");
  if (rawOutput !== undefined && rawOutput !== null) patch.rawOutput = rawOutput;
  return patch;
}

/**
 * Applies a tool call update: the fields it has replace the call's, `content` and `locations`
 * as whole lists, and the rest stay.
 *
 * @param call - The call so far, or `undefined` when the update is the first RIM hears of it.
 * @param patch - The update.
 * @returns The merged call.
 */
export function mergeToolCall(call: ToolCall | undefined, patch: ToolCallPatch): ToolCall {
  const base: ToolCall = call ?? {
    toolCallId: patch.toolCallId,
    title: "",
    kind: "other",
    status: "pending",
    content: [],
    locations: [],
  };
  const merged: ToolCall = { ...base };
  if (patch.title !== undefined) merged.title = patch.title;
  if (patch.kind !== undefined) merged.kind = patch.kind;
  if (patch.status !== undefined) merged.status = patch.status;
  if (patch.content !== undefined) merged.content = patch.content;
  if (patch.locations !== undefined) merged.locations = patch.locations;
  if (patch.rawInput !== undefined) merged.rawInput = patch.rawInput;
  if (patch.rawOutput !== undefined) merged.rawOutput = patch.rawOutput;
  return merged;
}

function parsePlanEntry(value: JsonValue): PlanEntry | null {
  if (!isObject(value)) return null;
  const content = text(value, "content");
  if (content === null) return null;
  return {
    content,
    priority: oneOf(field(value, "priority"), PRIORITIES) ?? "medium",
    status: oneOf(field(value, "status"), ENTRY_STATUSES) ?? "pending",
  };
}

function parseMode(value: JsonValue): SessionMode | null {
  if (!isObject(value)) return null;
  const id = text(value, "id");
  const name = text(value, "name");
  if (id === null || name === null) return null;
  return { id, name, description: text(value, "description") };
}

/**
 * Reads a session's modes.
 *
 * @returns The modes, or `null` when there are none or they are not well formed.
 */
export function parseModes(value: JsonValue | undefined): SessionModes | null {
  if (!isObject(value)) return null;
  const currentModeId = text(value, "currentModeId");
  const availableModes = list(field(value, "availableModes"), parseMode);
  if (currentModeId === null || availableModes === null || availableModes.length === 0) {
    return null;
  }
  return { currentModeId, availableModes };
}

function parseCommand(value: JsonValue): AgentCommand | null {
  if (!isObject(value)) return null;
  const name = text(value, "name");
  if (name === null) return null;
  const input = field(value, "input");
  return {
    name,
    description: text(value, "description") ?? "",
    hint: isObject(input) ? text(input, "hint") : null,
  };
}

function chunk(
  kind: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  update: JsonObject,
): SessionUpdate {
  return {
    kind,
    content: parseContentBlock(field(update, "content")),
    messageId: text(update, "messageId"),
  };
}

/**
 * Reads the `update` of a `session/update` notification.
 *
 * @returns The update, `unknown` for a kind RIM does not know or one missing what it needs.
 */
export function parseSessionUpdate(value: JsonValue | undefined): SessionUpdate {
  if (!isObject(value)) return { kind: "unknown" };
  const kind = field(value, "sessionUpdate");
  switch (kind) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return chunk(kind, value);
    case "tool_call": {
      const patch = parseToolCallPatch(value);
      return patch ? { kind: "tool_call", toolCall: mergeToolCall(undefined, patch) } : UNKNOWN;
    }
    case "tool_call_update": {
      const patch = parseToolCallPatch(value);
      return patch ? { kind: "tool_call_update", patch } : UNKNOWN;
    }
    case "plan": {
      const entries = list(field(value, "entries"), parsePlanEntry);
      return entries ? { kind: "plan", entries } : UNKNOWN;
    }
    case "available_commands_update": {
      const commands = list(field(value, "availableCommands"), parseCommand);
      return commands ? { kind: "available_commands_update", commands } : UNKNOWN;
    }
    case "current_mode_update": {
      const currentModeId = text(value, "currentModeId");
      return currentModeId === null ? UNKNOWN : { kind: "current_mode_update", currentModeId };
    }
    case "session_info_update":
      return { kind: "session_info_update", title: text(value, "title") };
    default:
      return UNKNOWN;
  }
}

const UNKNOWN: SessionUpdate = { kind: "unknown" };

function parseOption(value: JsonValue): PermissionOption | null {
  if (!isObject(value)) return null;
  const optionId = text(value, "optionId");
  const name = text(value, "name");
  const kind = oneOf(field(value, "kind"), OPTION_KINDS);
  if (optionId === null || name === null || kind === null) return null;
  return { optionId, name, kind };
}

function parseAuthMethod(value: JsonValue): AuthMethod | null {
  if (!isObject(value)) return null;
  const id = text(value, "id");
  const name = text(value, "name");
  if (id === null || name === null) return null;
  return {
    id,
    name,
    description: text(value, "description"),
    type: text(value, "type") ?? "agent",
  };
}

function parseCapabilities(value: JsonValue | undefined): AgentCapabilities {
  const caps = isObject(value) ? value : {};
  const mcp = field(caps, "mcpCapabilities");
  const prompt = field(caps, "promptCapabilities");
  const sessionCaps = field(caps, "sessionCapabilities");
  const resume = isObject(sessionCaps) ? field(sessionCaps, "resume") : undefined;
  return {
    loadSession: field(caps, "loadSession") === true,
    resumeSession: isObject(resume),
    mcpCapabilities: { http: flag(mcp, "http"), sse: flag(mcp, "sse") },
    promptCapabilities: {
      image: flag(prompt, "image"),
      audio: flag(prompt, "audio"),
      embeddedContext: flag(prompt, "embeddedContext"),
    },
    raw: value ?? null,
  };
}

function parseAgentInfo(value: JsonValue | undefined): AgentHello["agentInfo"] {
  if (!isObject(value)) return null;
  const name = text(value, "name");
  if (name === null) return null;
  return { name, title: text(value, "title"), version: text(value, "version") };
}

function mcpServersParam(servers: AcpHttpMcpServer[]): JsonValue {
  return servers.map((server) => ({
    type: server.type,
    name: server.name,
    url: server.url,
    headers: server.headers.map((header) => ({ name: header.name, value: header.value })),
  }));
}

/** An ACP client over one connection. */
export class AcpClient {
  private hello: AgentHello | null = null;
  private readonly permissions = new Map<string, Set<AbortController>>();

  constructor(
    private readonly connection: AcpConnection,
    private readonly handlers: AcpClientHandlers,
  ) {
    connection.onNotification((method, params) => {
      if (method !== "session/update" || !isObject(params)) return;
      const sessionId = text(params, "sessionId");
      if (sessionId === null) return;
      handlers.onUpdate(sessionId, parseSessionUpdate(field(params, "update")));
    });
    connection.handle("session/request_permission", (params, signal) =>
      this.askPermission(params, signal),
    );
  }

  /** What the agent said in `initialize`, once it has. */
  get agent(): AgentHello | null {
    return this.hello;
  }

  /**
   * Introduces RIM to the agent and learns what it can do.
   *
   * @returns What the agent said. Rejects with a plain sentence when the agent speaks another
   *   protocol version, or with the connection's error.
   */
  async initialize(): Promise<AgentHello> {
    const result = await this.connection.request(
      "initialize",
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "rim", title: "RIM", version: CLIENT_VERSION },
      },
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    const answer = isObject(result) ? result : {};
    const version = field(answer, "protocolVersion");
    if (version !== ACP_PROTOCOL_VERSION) {
      throw new Error(
        typeof version === "number" && Number.isInteger(version)
          ? `This agent speaks version ${version} of the Agent Client Protocol, and RIM speaks only version ${ACP_PROTOCOL_VERSION}.`
          : "This agent did not say which version of the Agent Client Protocol it speaks.",
      );
    }
    this.hello = {
      protocolVersion: version,
      agentCapabilities: parseCapabilities(field(answer, "agentCapabilities")),
      agentInfo: parseAgentInfo(field(answer, "agentInfo")),
      authMethods: list(field(answer, "authMethods"), parseAuthMethod) ?? [],
    };
    return this.hello;
  }

  /**
   * Opens a session. The params carry the MCP servers' headers, so they are never logged.
   *
   * @returns The session's id and modes.
   */
  async newSession(setup: SessionSetup): Promise<OpenedSession> {
    const result = await this.connection.request(
      "session/new",
      { cwd: setup.cwd, mcpServers: mcpServersParam(setup.mcpServers) },
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    const answer = isObject(result) ? result : {};
    const sessionId = text(answer, "sessionId");
    if (sessionId === null || sessionId === "") {
      throw new Error("The agent did not open a session.");
    }
    return { sessionId, modes: parseModes(field(answer, "modes")) };
  }

  /**
   * Opens an earlier session again; the agent replays it as updates first. Only for an agent
   * that offers `loadSession`.
   *
   * @returns The session's modes.
   */
  async loadSession(sessionId: string, setup: SessionSetup): Promise<SessionModes | null> {
    if (!this.hello?.agentCapabilities.loadSession) {
      throw new Error("This agent can't open earlier sessions.");
    }
    const result = await this.connection.request(
      "session/load",
      { sessionId, cwd: setup.cwd, mcpServers: mcpServersParam(setup.mcpServers) },
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    return parseModes(isObject(result) ? field(result, "modes") : undefined);
  }

  /**
   * Continues an earlier session without replaying it. Only for an agent that offers it.
   *
   * @returns The session's modes.
   */
  async resumeSession(sessionId: string, setup: SessionSetup): Promise<SessionModes | null> {
    if (!this.hello?.agentCapabilities.resumeSession) {
      throw new Error("This agent can't continue earlier sessions.");
    }
    const result = await this.connection.request(
      "session/resume",
      { sessionId, cwd: setup.cwd, mcpServers: mcpServersParam(setup.mcpServers) },
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    return parseModes(isObject(result) ? field(result, "modes") : undefined);
  }

  /**
   * Sends a prompt and waits for the turn to end, however long it takes.
   *
   * @param blocks - What the person wrote.
   * @returns Why the turn ended.
   */
  async prompt(sessionId: string, blocks: ContentBlock[]): Promise<StopReason> {
    const result = await this.connection.request("session/prompt", {
      sessionId,
      prompt: blocks.map(promptBlock),
    });
    const reason = isObject(result) ? oneOf(field(result, "stopReason"), STOP_REASONS) : null;
    return reason ?? "end_turn";
  }

  /**
   * Cancels the session's turn. Every permission request of the session still waiting is
   * answered `cancelled` first, as the protocol asks.
   */
  async cancel(sessionId: string): Promise<void> {
    for (const controller of this.permissions.get(sessionId) ?? []) controller.abort();
    await this.connection.notify("session/cancel", { sessionId });
  }

  /** Switches the session to another of its modes. */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.connection.request("session/set_mode", { sessionId, modeId });
  }

  private async askPermission(
    params: JsonValue | undefined,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const request = isObject(params) ? params : {};
    const sessionId = text(request, "sessionId");
    const toolCall = parseToolCallPatch(field(request, "toolCall"));
    const options = list(field(request, "options"), parseOption) ?? [];
    if (sessionId === null || toolCall === null || options.length === 0) {
      return { outcome: { outcome: "cancelled" } };
    }
    const controller = new AbortController();
    const forward = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forward, { once: true });
    const waiting = this.permissions.get(sessionId) ?? new Set<AbortController>();
    waiting.add(controller);
    this.permissions.set(sessionId, waiting);
    try {
      const cancelled = new Promise<PermissionOutcome>((resolve) => {
        if (controller.signal.aborted) resolve({ outcome: "cancelled" });
        controller.signal.addEventListener("abort", () => resolve({ outcome: "cancelled" }), {
          once: true,
        });
      });
      const answer = await Promise.race([
        this.handlers
          .onPermission({ sessionId, toolCall, options, signal: controller.signal })
          .catch((): PermissionOutcome => ({ outcome: "cancelled" })),
        cancelled,
      ]);
      if (
        controller.signal.aborted ||
        answer.outcome !== "selected" ||
        !options.some((option) => option.optionId === answer.optionId)
      ) {
        return { outcome: { outcome: "cancelled" } };
      }
      return { outcome: { outcome: "selected", optionId: answer.optionId } };
    } finally {
      signal.removeEventListener("abort", forward);
      waiting.delete(controller);
      if (waiting.size === 0) this.permissions.delete(sessionId);
    }
  }
}

/** A content block as a prompt sends it. */
function promptBlock(block: ContentBlock): JsonValue {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "resource_link":
      return {
        type: "resource_link",
        uri: block.uri,
        name: block.name,
        ...(block.title !== null ? { title: block.title } : {}),
        ...(block.mimeType !== null ? { mimeType: block.mimeType } : {}),
      };
    default:
      throw new Error("A prompt can only hold text and links.");
  }
}
