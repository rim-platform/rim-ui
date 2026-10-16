// The esbuild options of a WebSandboxed plugin's browser build, shared by
// `rim-plugin-bundle` and the host's conformance test.

import { dirname } from "node:path";

/**
 * Build options that bundle `entry` into the single ES module `outfile` for the
 * browser. Paths in the output are relative to `workingDir`, so the same plugin
 * builds to the same bytes from any working directory.
 */
export function browserBuildOptions(entry, outfile, workingDir = dirname(entry)) {
  return {
    entryPoints: [entry],
    outfile,
    absWorkingDir: workingDir,
    bundle: true,
    platform: "browser",
    conditions: ["browser"],
    format: "esm",
    target: "es2022",
    logLevel: "warning",
  };
}

/** Drop a leading `#!` line, which esbuild keeps from the entry point. */
export function withoutHashbang(code) {
  return code.replace(/^#![^\n]*\n/, "");
}
