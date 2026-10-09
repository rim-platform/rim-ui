/**
 * TypeScript SDK for RIM plugin protocol v1.
 *
 * A plugin is either a local process the RIM desktop app starts and talks to
 * over stdio, or a WebSandboxed plugin that runs in a sandboxed frame of the
 * app and talks over a MessagePort. Define it with {@link definePlugin} and call
 * `run()`; the SDK does the transport, the handshake, heartbeats, the
 * dangerous-command gate and shutdown. The protocol itself is
 * `protocol/plugin-protocol-v1.schema.json` in rim-ui. Bundlers that honour the
 * `browser` export condition get `index.browser.ts`, with the same API.
 *
 * @packageDocumentation
 */

import { nodePlatform } from "./node.ts";
import { createDefinePlugin } from "./plugin.ts";

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
export const definePlugin = createDefinePlugin(nodePlatform);

export { stdioTransport } from "./node.ts";
export * from "./exports.ts";
