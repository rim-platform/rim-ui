// Generated from protocol/plugin-protocol-v1.schema.json by
// sdk/plugin-sdk/scripts/generate-protocol.ts. Do not edit: run `npm run sdk:generate`.

/** The protocol version these types describe. */
export const PROTOCOL_VERSION = 1;

/** A 4-byte unsigned length in little-endian byte order, then exactly that many bytes of UTF-8 JSON holding one JSON-RPC 2.0 message. */
export const MAX_FRAME_BYTES = 4194304;

/** JSON-RPC error codes from the schema's x-errorCodes. */
export const ErrorCode = {
  /** the frame is not valid JSON. */
  PARSE_ERROR: -32700,
  /** the JSON is not a valid JSON-RPC 2.0 message. */
  INVALID_REQUEST: -32600,
  /** the receiver does not implement the method. */
  METHOD_NOT_FOUND: -32601,
  /** params are missing or have the wrong shape, including an unknown commandId. */
  INVALID_PARAMS: -32602,
  /** the receiver failed while handling a valid request. */
  INTERNAL_ERROR: -32603,
  /** the user has not approved the capability the method needs. */
  CAPABILITY_DENIED: -32000,
  /** the plugin called a capability more often than its per-minute limit. */
  RATE_LIMITED: -32001,
  /** the plugin ran the command and it failed; message says why. */
  PLUGIN_ERROR: -32002,
} as const;

/** Method names of the frozen v1 frames. */
export const Method = {
  handshake: "rim.handshake",
  heartbeat: "rim.heartbeat",
  shutdown: "rim.shutdown",
  principalChanged: "rim.principal.changed",
  principalsRemapped: "rim.principals.remapped",
  commandExecute: "rim.command.execute",
  log: "rim.log",
} as const;

/** Always the string 2.0. */
export type JsonRpcVersion = "2.0";

/** Request id, echoed unchanged in the response. */
export type Id = number | string;

/** How a plugin sees a person. */
export interface Principal {
  /** Opaque, stable id of the person. Never a UUID and never a name@domain. */
  principalId: string;
  /** Label to show for the person. Not unique and may change. */
  displayName: string;
}

/** A Principal, or null when nobody is signed in. */
export type NullablePrincipal = Principal | null;

/** JSON-RPC error object. code is one of x-errorCodes or another integer the plugin documents. */
export interface Error {
  /** Error code, see x-errorCodes. */
  code: number;
  /** One-line, human-readable reason. */
  message: string;
  /** Optional machine-readable details. */
  data?: unknown;
}

/** Answer to any request that failed. */
export interface ErrorResponse {
  jsonrpc: JsonRpcVersion;
  id: Id;
  error: Error;
}

export interface HandshakeParams {
  /** The version the host prefers, the first entry of supportedVersions. */
  protocolVersion: number;
  /** Every protocol version the host speaks, newest first. */
  supportedVersions: number[];
  /** The plugin id from the manifest the host loaded for this process. */
  pluginId: string;
  /** The host application's version. */
  hostVersion: string;
  /** Capabilities the user approved for this plugin. */
  grantedCapabilities: string[];
  /** The signed-in user the plugin acts for, or null when nobody is signed in yet. */
  principal: NullablePrincipal;
}

/** Host to plugin, the first request on every connection. Its shape is the same in every protocol version, so any host can negotiate with any plugin. */
export interface HandshakeRequest {
  jsonrpc: JsonRpcVersion;
  id: Id;
  method: "rim.handshake";
  params: HandshakeParams;
}

export interface HandshakeResult {
  /** Whether the plugin accepts the connection. */
  accepted: boolean;
  /** The version the plugin chose; must be one of supportedVersions. */
  protocolVersion: number;
  /** The plugin's own id; must equal params.pluginId. */
  pluginId: string;
  /** Why the plugin refused, when accepted is false. */
  error?: string | null;
}

/** Plugin to host. A refusal is accepted: false with error set; the host then stops the plugin. See x-versioning.negotiation for a plugin that speaks none of the offered versions. */
export interface HandshakeResponse {
  jsonrpc: JsonRpcVersion;
  id: Id;
  result: HandshakeResult;
}

/** Host to plugin every 30 seconds. A plugin that has not answered within 5 seconds is marked unresponsive. */
export interface HeartbeatRequest {
  jsonrpc: JsonRpcVersion;
  /** Negative integer. */
  id: number;
  method: "rim.heartbeat";
}

/** Plugin to host. Any object result counts as alive. */
export interface HeartbeatResponse {
  jsonrpc: JsonRpcVersion;
  id: Id;
  result: Record<string, unknown>;
}

/** Host to plugin: exit now. The host closes stdin right after it. */
export interface ShutdownNotification {
  jsonrpc: JsonRpcVersion;
  method: "rim.shutdown";
}

/** Host to plugin: the signed-in user changed (sign-in, sign-out, another account, or a new principal id scheme). */
export interface PrincipalChangedNotification {
  jsonrpc: JsonRpcVersion;
  method: "rim.principal.changed";
  params: {
    /** The signed-in user from now on, or null after sign-out. */
    principal: NullablePrincipal;
  };
}

/** Host to plugin: provisional principal ids (rimp0_) and the key-based ids that replaced them. Sent right after every handshake when the host knows at least one mapping, and to running plugins when it learns a new one. The list is the whole mapping the host knows, so applying it must be idempotent: replace each stored from with its to. */
export interface PrincipalsRemappedNotification {
  jsonrpc: JsonRpcVersion;
  method: "rim.principals.remapped";
  params: {
    /** Every switched id this host knows, each from once. */
    mappings: {
      /** The provisional id. */
      from: string;
      /** The id that replaced it. */
      to: string;
    }[];
  };
}

export interface CommandExecuteParams {
  /** The id of a command in the plugin's manifest. */
  commandId: string;
  /** The command's arguments, keyed by argument name. Empty when there are none. */
  args: Record<string, unknown>;
  /** The signed-in user on whose behalf the command runs, or null. */
  invoker: NullablePrincipal;
  /** user: a person ran it (palette, keybind, panel, context action). agent: the AI agent ran it after the user consented to this plugin's AI commands. */
  initiator: "user" | "agent";
  /** True only for a dangerous command the user confirmed for this run. See x-confirmationGate. */
  confirmed: boolean;
}

/** Host to plugin: run one of the plugin's manifest commands. The host gives up after 30 seconds. */
export interface CommandExecuteRequest {
  jsonrpc: JsonRpcVersion;
  id: Id;
  method: "rim.command.execute";
  params: CommandExecuteParams;
}

export interface CommandResult {
  /** The command's output, any JSON value. Missing means null. */
  payload?: unknown;
  /** Optional one-line summary the host may show to the user. */
  message?: string;
}

/** Plugin to host. A failed command is an ErrorResponse instead, usually with PLUGIN_ERROR. */
export interface CommandExecuteResponse {
  jsonrpc: JsonRpcVersion;
  id: Id;
  result: CommandResult;
}

export interface LogParams {
  /** Severity. */
  level: "debug" | "info" | "warn" | "error";
  /** The line to log. */
  message: string;
}

/** Plugin to host: write a line to the host log. Needs no capability. Without an id it is a notification and gets no answer. */
export interface LogRequest {
  jsonrpc: JsonRpcVersion;
  id?: Id;
  method: "rim.log";
  params: LogParams;
}

/** Host to plugin, only when rim.log was sent with an id. */
export interface LogResponse {
  jsonrpc: JsonRpcVersion;
  id: Id;
  result: {
    ok: true;
  };
}
