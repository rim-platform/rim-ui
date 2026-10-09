/**
 * The browser build of the TypeScript SDK for RIM plugin protocol v1, for
 * WebSandboxed plugins: the same API as the Node build, with no `node:`
 * imports. A plugin frame's `run()` talks over `globalThis.rimPluginPort` and
 * checks the plugin against `globalThis.rimPluginManifest`.
 *
 * @packageDocumentation
 */

import { createDefinePlugin, type Platform } from "./plugin.ts";

/** Where a WebSandboxed plugin runs: a sandboxed frame with a port to the host. */
const browserPlatform: Platform = {
  streams() {
    throw new Error("this plugin runs in a RIM plugin frame, which has no stdio");
  },
  claimStdio() {
    return () => {};
  },
  readManifest: () => undefined,
  stderr: (line) => console.error(line),
};

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
export const definePlugin = createDefinePlugin(browserPlatform);

export * from "./exports.ts";
