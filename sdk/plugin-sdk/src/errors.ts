import type * as wire from "./generated/protocol.ts";
import { ErrorCode } from "./generated/protocol.ts";

/**
 * Throw this from a command to answer the host with a specific JSON-RPC error.
 * Anything else a command throws is sent as `PLUGIN_ERROR` with its message.
 *
 * @example
 * throw new PluginError("kubectl failed: context not found");
 * throw new PluginError("pod name is required", { code: ErrorCode.INVALID_PARAMS });
 */
export class PluginError extends Error {
  /** JSON-RPC error code, one of {@link ErrorCode} or a code the plugin documents. */
  readonly code: number;
  /** Optional machine-readable details, sent as `error.data`. Must be JSON. */
  readonly data: unknown;

  constructor(message: string, options: { code?: number; data?: unknown } = {}) {
    super(message);
    this.name = "PluginError";
    this.code = options.code ?? ErrorCode.PLUGIN_ERROR;
    this.data = options.data;
  }
}

/** The host answered a plugin request with an error, or the request could not complete. */
export class HostRequestError extends Error {
  /** The method the plugin called. */
  readonly method: string;
  /** JSON-RPC error code the host sent, such as `CAPABILITY_DENIED`. */
  readonly code: number;
  /** `error.data` from the host, if any. */
  readonly data: unknown;

  constructor(method: string, error: wire.Error) {
    super(`${method} failed (${error.code}): ${error.message}`);
    this.name = "HostRequestError";
    this.method = method;
    this.code = error.code;
    this.data = error.data;
  }
}

/** The JSON-RPC error object for anything thrown while handling a request. */
export function toWireError(error: unknown, fallbackCode: number): wire.Error {
  if (error instanceof PluginError) {
    const wireError: wire.Error = { code: error.code, message: error.message };
    if (error.data !== undefined) wireError.data = error.data;
    return wireError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: fallbackCode, message: message || "unknown error" };
}

export { ErrorCode };
