// The esbuild options of a WebSandboxed plugin's browser build, shared by
// `rim-plugin-bundle` and the host's conformance test.

import { resolve } from "node:path";

/** Build options that bundle `entry` into the single ES module `outfile` for the browser. */
export function browserBuildOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "browser",
    conditions: ["browser"],
    format: "esm",
    target: "es2022",
    plugins: [browserSdk()],
    logLevel: "warning",
  };
}

/** Drop a leading `#!` line, which esbuild keeps from the entry point. */
export function withoutHashbang(code) {
  return code.replace(/^#![^\n]*\n/, "");
}

/**
 * Resolve the SDK's Node entry to its browser entry, as the `browser` export
 * condition does for a package import, for plugins that import the SDK by path.
 */
function browserSdk() {
  return {
    name: "rim-plugin-sdk-browser",
    setup(esbuild) {
      esbuild.onResolve({ filter: /plugin-sdk[\\/]src[\\/]index\.ts$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path).replace(/index\.ts$/, "index.browser.ts"),
      }));
    },
  };
}
