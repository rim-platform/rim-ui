// Build the package into dist/ as `npm publish` ships it: the entry points
// compiled to JavaScript with their type declarations, and the bundler script
// with the helpers it imports, so nothing in the package needs Node to strip
// types (Node never does under node_modules).
//
// Usage: node scripts/build.mjs   (npm run sdk:build at the repository root)

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const SDK_DIR = join(import.meta.dirname, "..");
const DIST = join(SDK_DIR, "dist");
const REPO_LICENSE = join(SDK_DIR, "../../LICENSE");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (readFileSync(join(SDK_DIR, "LICENSE"), "utf8") !== readFileSync(REPO_LICENSE, "utf8")) {
  fail("sdk/plugin-sdk/LICENSE differs from the repository's LICENSE: copy it over again");
}

rmSync(DIST, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(SDK_DIR, "tsconfig.build.json")], {
  stdio: "inherit",
});

// tsc rewrites `.ts` imports to `.js` in the JavaScript but not in the
// declarations; rewrite those too, so a consumer's TypeScript settings need not
// allow `.ts` imports.
for (const name of readdirSync(DIST, { recursive: true, encoding: "utf8" })) {
  if (!name.endsWith(".d.ts")) continue;
  const path = join(DIST, name);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.js$1"));
}

// The bundler imports the bundle writer from the sources; in dist it sits one
// folder up as JavaScript.
mkdirSync(join(DIST, "scripts"));
copyFileSync(join(SDK_DIR, "scripts/browser-build.mjs"), join(DIST, "scripts/browser-build.mjs"));
const bundler = readFileSync(join(SDK_DIR, "scripts/bundle-plugin.mjs"), "utf8");
const SOURCE_IMPORT = `from "../src/bundle.ts";`;
if (bundler.split(SOURCE_IMPORT).length !== 2) {
  fail(`scripts/bundle-plugin.mjs must import the bundle writer exactly once as ${SOURCE_IMPORT}`);
}
const bin = join(DIST, "scripts/bundle-plugin.mjs");
writeFileSync(bin, bundler.replace(SOURCE_IMPORT, `from "../bundle.js";`));
chmodSync(bin, 0o755);

console.log(`built ${DIST}`);
