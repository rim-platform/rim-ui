// Everything both builds of the SDK export besides `definePlugin`.

export {
  SUPPORTED_VERSIONS,
  type CommandContext,
  type CommandDefinition,
  type CommandOutput,
  type Host,
  type Initiator,
  type Logger,
  type LogLevel,
  type Panels,
  type Plugin,
  type PluginDefinition,
  type RunOptions,
  type Storage,
} from "./plugin.ts";
export { ErrorCode, HostRequestError, PluginError } from "./errors.ts";
export {
  samePrincipal,
  type Principal,
  type PrincipalId,
  type PrincipalMapping,
} from "./principal.ts";
export {
  encodeFrame,
  encodeText,
  FrameDecoder,
  FrameTooLargeError,
  type DecodedFrame,
} from "./framing.ts";
export {
  portTransport,
  streamTransport,
  type FrameSink,
  type PortLike,
  type Transport,
} from "./transport.ts";
export { MAX_FRAME_BYTES, Method, PROTOCOL_VERSION } from "./generated/protocol.ts";
/** The protocol's frames and payloads exactly as the schema defines them. */
export type * as wire from "./generated/protocol.ts";
