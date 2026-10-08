/**
 * TypeScript SDK for RIM plugin protocol v1.
 *
 * A plugin is a local process the RIM desktop app starts and talks to over
 * stdio. Define it with {@link definePlugin} and call `run()`; the SDK does the
 * framing, the handshake, heartbeats, the dangerous-command gate and shutdown.
 * The protocol itself is `protocol/plugin-protocol-v1.schema.json` in rim-ui.
 *
 * @packageDocumentation
 */

export {
  definePlugin,
  SUPPORTED_VERSIONS,
  type CommandContext,
  type CommandDefinition,
  type CommandOutput,
  type FrameSink,
  type Host,
  type Initiator,
  type Logger,
  type LogLevel,
  type Panels,
  type Plugin,
  type PluginDefinition,
  type RunOptions,
} from "./plugin.ts";
export { ErrorCode, HostRequestError, PluginError } from "./errors.ts";
export { samePrincipal, type Principal, type PrincipalId } from "./principal.ts";
export { encodeFrame, FrameDecoder, FrameTooLargeError, type DecodedFrame } from "./framing.ts";
export { MAX_FRAME_BYTES, Method, PROTOCOL_VERSION } from "./generated/protocol.ts";
/** The protocol's frames and payloads exactly as the schema defines them. */
export type * as wire from "./generated/protocol.ts";
