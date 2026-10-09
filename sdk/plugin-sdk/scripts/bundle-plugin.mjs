#!/usr/bin/env node
// Bundle a TypeScript plugin: a directory that installs by copying it into
// ~/.rim/plugins (rim-plugin.json, a single main.mjs with the SDK inside, and
// the plugin's panels/ folder if it has one), and the same files as one
// <plugin_id>-<version>.rimbundle beside that directory, whose SHA-256 and size
// it prints. A WebSandboxed plugin is built for the browser and must come out
// self-contained. Needs esbuild.
//
// Usage: rim-plugin-bundle <plugin-dir> [out-dir]
// out-dir defaults to <plugin-dir>/dist/<plugin_id>.

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

import { browserBuildOptions, withoutHashbang } from "./browser-build.mjs";
import { isBundlePath, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES, writeBundle } from "../src/bundle.ts";

const [pluginArg, outArg] = process.argv.slice(2);
if (!pluginArg) {
  console.error("usage: rim-plugin-bundle <plugin-dir> [out-dir]");
  process.exit(2);
}

const pluginDir = resolve(pluginArg);
const manifest = JSON.parse(readFileSync(join(pluginDir, "rim-plugin.json"), "utf8"));
const web = manifest.runtime_kind === "WebSandboxed";
const outDir = resolve(outArg ?? join(pluginDir, "dist", manifest.plugin_id));
const entry = join(pluginDir, manifest.entrypoint);
const outFile = join(outDir, "main.mjs");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// out-dir is wiped first, so refuse anything that is not a previous bundle:
// the plugin's own folder, a folder holding it, or one with other files in it.
const fromOut = relative(outDir, pluginDir);
const holdsPlugin =
  fromOut === "" || !(fromOut === ".." || fromOut.startsWith(`..${sep}`) || isAbsolute(fromOut));
if (holdsPlugin) {
  console.error(`refusing to bundle into ${outDir}: it holds the plugin itself`);
  process.exit(2);
}
if (existsSync(outDir) && readdirSync(outDir).length > 0 && !isBundle(outDir)) {
  console.error(`refusing to bundle into ${outDir}: it is not empty and not a previous bundle`);
  process.exit(2);
}

// The panel files, relative to the plugin folder. Dotfiles never ship; any
// other name must be a bundle path. Nothing else of the folder is bundled.
const panelFiles = existsSync(join(pluginDir, "panels")) ? listFiles(pluginDir, "panels") : [];
for (const path of panelFiles) {
  if (!isBundlePath(path)) fail(`refusing ${path}: bundle paths are A-Z a-z 0-9 . _ - segments`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

if (web) {
  // A browser build: no Node APIs, the SDK's browser entry, and one module the
  // frame shell can import from a blob: URL, so nothing left to import.
  await build(browserBuildOptions(entry, outFile));
  const code = withoutHashbang(readFileSync(outFile, "utf8"));
  writeFileSync(outFile, code);
  if (
    /^\s*(import|export)\b[^\n]*["']\s*;?\s*$/m.test(code) ||
    /(?<![\w$.])import\s*\(/.test(code)
  ) {
    fail(`${outFile} still imports something: a web plugin must bundle into one module`);
  }
  if (/["'`]node:/.test(code)) {
    fail(`${outFile} refers to a node: module, which a web plugin cannot use`);
  }
} else {
  // esbuild keeps an entry point's own #! line; add one only when it has none.
  const hasShebang = readFileSync(entry, "utf8").startsWith("#!");
  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: hasShebang ? undefined : { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  });
  chmodSync(outFile, 0o755);
}

writeFileSync(
  join(outDir, "rim-plugin.json"),
  `${JSON.stringify({ ...manifest, entrypoint: "main.mjs" }, null, 2)}\n`,
);
for (const path of panelFiles) {
  mkdirSync(dirname(join(outDir, path)), { recursive: true });
  writeFileSync(join(outDir, path), readFileSync(join(pluginDir, path)));
}

// The same files as one bundle, beside the directory.
const files = ["main.mjs", "rim-plugin.json", ...panelFiles].map((path) => ({
  path,
  bytes: readFileSync(join(outDir, path)),
}));
if (files.length > MAX_BUNDLE_FILES) {
  fail(`the bundle would hold ${files.length} files, over ${MAX_BUNDLE_FILES}`);
}
const bundle = writeBundle(files);
if (bundle.length > MAX_BUNDLE_BYTES)
  fail(`the bundle would be ${bundle.length} bytes, over 8 MiB`);
const bundleFile = join(dirname(outDir), `${manifest.plugin_id}-${manifest.version}.rimbundle`);
writeFileSync(bundleFile, bundle);
const sha256 = createHash("sha256").update(bundle).digest("hex");

console.log(`bundled ${manifest.plugin_id} into ${outDir} and ${bundleFile}`);
console.log(`sha256 ${sha256}  size ${bundle.length}`);

/** True when `dir` looks like this script's output: a manifest pointing at main.mjs. */
function isBundle(dir) {
  try {
    const previous = JSON.parse(readFileSync(join(dir, "rim-plugin.json"), "utf8"));
    return previous.entrypoint === "main.mjs" && existsSync(join(dir, "main.mjs"));
  } catch {
    return false;
  }
}

/** Every file under `root/folder`, as `/`-separated paths from `root`, dotfiles left out. */
function listFiles(root, folder) {
  const found = [];
  for (const name of readdirSync(join(root, folder))) {
    if (name.startsWith(".")) continue;
    const path = `${folder}/${name}`;
    if (statSync(join(root, path)).isDirectory()) found.push(...listFiles(root, path));
    else found.push(path);
  }
  return found.sort();
}
