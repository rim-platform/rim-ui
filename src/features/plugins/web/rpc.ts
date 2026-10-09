// Protocol v1 constants the web host needs: methods, error codes and limits.

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_VERSIONS: readonly number[] = [1];

/** Largest message on the port, in UTF-8 bytes, both ways. */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export const Method = {
  handshake: "rim.handshake",
  heartbeat: "rim.heartbeat",
  shutdown: "rim.shutdown",
  principalChanged: "rim.principal.changed",
  principalsRemapped: "rim.principals.remapped",
  commandExecute: "rim.command.execute",
  log: "rim.log",
  updatePanel: "rim.ui.update_panel",
  storageGet: "rim.storage.get",
  storageSet: "rim.storage.set",
} as const;

export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  CAPABILITY_DENIED: -32000,
  RATE_LIMITED: -32001,
  PLUGIN_ERROR: -32002,
} as const;

/** The capability each host method needs, as the desktop's capability table has it. */
export const METHOD_CAPABILITY: Readonly<Record<string, string>> = {
  "rim.chat.list_messages": "chat.read",
  "rim.chat.get_message": "chat.read",
  "rim.chat.search_messages": "chat.read",
  "rim.chat.post_message": "chat.write",
  "rim.events.subscribe": "events.read",
  "rim.process.spawn": "local.process",
  "rim.process.kill": "local.process",
  "rim.network.http_request": "network",
  "rim.network.websocket_connect": "network",
  "rim.fs.read_file": "fs.read",
  "rim.fs.write_file": "fs.write",
  "rim.fs.list_dir": "fs.read",
  "rim.ui.show_notification": "ui.notify",
  "rim.ui.show_panel": "ui.panel",
  "rim.ui.update_panel": "ui.panel",
};

/** A person as a plugin sees them. */
export interface Principal {
  principalId: string;
  displayName: string;
}

/** A provisional principal id and the key-based id that replaced it. */
export interface PrincipalMapping {
  from: string;
  to: string;
}

export type JsonRpcId = number | string;

/** A JSON-RPC error object. */
export interface RpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** A request answered with a JSON-RPC error, or that could not complete. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }

  toBody(): RpcErrorBody {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

const encoder = new TextEncoder();

/**
 * UTF-8 length of `text`. A string of more UTF-16 units than the limit is over
 * it whatever its bytes, so it is not encoded.
 */
export function utf8Length(text: string): number {
  if (text.length > MAX_MESSAGE_BYTES) return text.length;
  return encoder.encode(text).length;
}

/** True for an id v1 allows: an integer or a string, never null. */
export function isRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}
