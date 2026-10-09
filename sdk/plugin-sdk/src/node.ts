import { Console } from "node:console";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseManifestInfo, type ManifestInfo } from "./manifest.ts";
import type { Platform } from "./plugin.ts";
import { streamTransport, type Transport } from "./transport.ts";

/**
 * Read `rim-plugin.json`. Returns `undefined` when the file does not exist, so
 * a plugin started outside the host (in a test, say) still runs.
 *
 * @throws Error when the file exists but is not a manifest.
 */
export function readManifest(path: string): ManifestInfo | undefined {
  const fullPath = resolve(path);
  let text: string;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseManifestInfo(text, fullPath);
}

/** The process's stdin and stdout as a transport, with frames as the host starts a local plugin. */
export function stdioTransport(): Transport {
  return streamTransport(process.stdin, process.stdout);
}

/** Where a local-process plugin runs: Node, talking over its stdio. */
export const nodePlatform: Platform = {
  streams: () => ({ input: process.stdin, output: process.stdout }),
  claimStdio() {
    // stdout carries frames, so anything a plugin prints goes to stderr instead.
    globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
    return (code) => process.exit(code);
  },
  readManifest,
  stderr: (line) => process.stderr.write(`${line}\n`),
};
