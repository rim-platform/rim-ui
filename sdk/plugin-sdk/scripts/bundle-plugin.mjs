#!/usr/bin/env node
// Bundle a TypeScript plugin: a directory that installs by copying it into
// ~/.rim/plugins (rim-plugin.json, a single main.mjs with the SDK inside, and
// the plugin's panels/ folder if it has one), and the same files as one
// <plugin_id>-<version>.rimbundle beside that directory, whose SHA-256 and size
// it prints. A WebSandboxed plugin is built for the browser and must come out
// self-contained. Needs esbuild.
//
// A plugin folder can also hold its own build, as a plugin repository does:
// main.mjs beside a manifest whose entrypoint is main.mjs, built from the
// source --entry names. --in-place writes that main.mjs; --check builds into a
// temporary folder and exits 1, naming each file, when the folder's main.mjs or
// panels/ differ from that build.
//
// Usage: rim-plugin-bundle [--entry <file>] <plugin-dir> [out-dir]
//        rim-plugin-bundle --check | --in-place [--entry <file>] <plugin-dir>
// out-dir defaults to <plugin-dir>/dist/<plugin_id>. --entry is relative to
// plugin-dir and defaults to the manifest's entrypoint.

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

import { browserBuildOptions, withoutHashbang } from "./browser-build.mjs";
import { isBundlePath, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES, writeBundle } from "../src/bundle.ts";

const USAGE =
  "usage: rim-plugin-bundle [--check | --in-place] [--entry <file>] <plugin-dir> [out-dir]";
const BUILT_ENTRY = "main.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

let mode = "bundle";
let entryArg;
const positional = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--check" || arg === "--in-place") {
    if (mode !== "bundle") usage("--check and --in-place exclude each other");
    mode = arg.slice(2);
  } else if (arg === "--entry") {
    entryArg = args[++i];
    if (!entryArg) usage("--entry needs a file");
  } else if (arg.startsWith("--")) {
    usage(`unknown option ${arg}`);
  } else {
    positional.push(arg);
  }
}
const [pluginArg, outArg] = positional;
if (!pluginArg || positional.length > 2) usage();
if (mode !== "bundle" && outArg) usage(`--${mode} builds in a temporary folder: drop ${outArg}`);

const pluginDir = resolve(pluginArg);
const manifest = JSON.parse(readFileSync(join(pluginDir, "rim-plugin.json"), "utf8"));
const web = manifest.runtime_kind === "WebSandboxed";
const entry = resolve(pluginDir, entryArg ?? manifest.entrypoint);
if (mode !== "bundle" && entry === join(pluginDir, BUILT_ENTRY)) {
  usage(`--${mode} builds ${BUILT_ENTRY} itself: name its source with --entry <file>`);
}
if (mode === "in-place" && manifest.entrypoint !== BUILT_ENTRY) {
  usage(
    `--in-place needs rim-plugin.json's entrypoint to be ${BUILT_ENTRY}, as a built plugin's is`,
  );
}

// The panel files, relative to the plugin folder. Dotfiles never ship; any
// other name must be a bundle path. Nothing else of the folder is bundled.
const panelFiles = existsSync(join(pluginDir, "panels")) ? listFiles(pluginDir, "panels") : [];
for (const path of panelFiles) {
  if (!isBundlePath(path)) fail(`refusing ${path}: bundle paths are A-Z a-z 0-9 . _ - segments`);
}

if (mode === "bundle") {
  const outDir = resolve(outArg ?? join(pluginDir, "dist", manifest.plugin_id));
  refuseOutDir(outDir);
  await buildInto(outDir);
  writeBundleFile(outDir);
} else {
  const scratch = mkdtempSync(join(tmpdir(), "rim-plugin-bundle-"));
  process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
  const outDir = join(scratch, manifest.plugin_id);
  await buildInto(outDir);
  if (mode === "check") check(outDir);
  else {
    copyFileSync(join(outDir, BUILT_ENTRY), join(pluginDir, BUILT_ENTRY));
    if (!web) chmodSync(join(pluginDir, BUILT_ENTRY), 0o755);
    console.log(`built ${relative(pluginDir, entry)} into ${join(pluginDir, BUILT_ENTRY)}`);
  }
}

/** Refuse an out-dir that is not a previous bundle, since it is wiped first. */
function refuseOutDir(outDir) {
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
}

/** Build the plugin into `outDir`: its manifest, main.mjs and panel files. */
async function buildInto(outDir) {
  const outFile = join(outDir, BUILT_ENTRY);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  if (web) {
    // A browser build: no Node APIs, the SDK's browser entry, and one module the
    // frame shell can import from a blob: URL, so nothing left to import.
    await build(browserBuildOptions(entry, outFile, pluginDir));
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
      absWorkingDir: pluginDir,
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
    `${JSON.stringify({ ...manifest, entrypoint: BUILT_ENTRY }, null, 2)}\n`,
  );
  for (const path of panelFiles) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), readFileSync(join(pluginDir, path)));
  }
}

/** Write the files of `outDir` as one bundle beside it, and print its hash and size. */
function writeBundleFile(outDir) {
  const files = [BUILT_ENTRY, "rim-plugin.json", ...panelFiles].map((path) => ({
    path,
    bytes: readFileSync(join(outDir, path)),
  }));
  if (files.length > MAX_BUNDLE_FILES) {
    fail(`the bundle would hold ${files.length} files, over ${MAX_BUNDLE_FILES}`);
  }
  const bundle = writeBundle(files);
  if (bundle.length > MAX_BUNDLE_BYTES) {
    fail(`the bundle would be ${bundle.length} bytes, over 8 MiB`);
  }
  const bundleFile = join(dirname(outDir), `${manifest.plugin_id}-${manifest.version}.rimbundle`);
  writeFileSync(bundleFile, bundle);
  const sha256 = createHash("sha256").update(bundle).digest("hex");

  console.log(`bundled ${manifest.plugin_id} into ${outDir} and ${bundleFile}`);
  console.log(`sha256 ${sha256}  size ${bundle.length}`);
}

/** Compare the plugin folder's own build with the fresh one in `outDir`; exit 1 on a difference. */
function check(outDir) {
  const differences = [];
  if (manifest.entrypoint !== BUILT_ENTRY) {
    differences.push(
      `rim-plugin.json: entrypoint is ${manifest.entrypoint}, a built plugin's is ${BUILT_ENTRY}`,
    );
  }
  for (const path of [BUILT_ENTRY, ...panelFiles]) {
    const committed = join(pluginDir, path);
    if (!existsSync(committed)) differences.push(`${path}: missing`);
    else if (!readFileSync(committed).equals(readFileSync(join(outDir, path)))) {
      differences.push(`${path}: differs from a fresh build`);
    } else if (path === BUILT_ENTRY && !web && process.platform !== "win32") {
      if ((statSync(committed).mode & 0o111) === 0) differences.push(`${path}: not executable`);
    }
  }
  if (differences.length > 0) {
    console.error(`${pluginDir} does not hold a fresh build of ${relative(pluginDir, entry)}:`);
    for (const difference of differences) console.error(`  ${difference}`);
    const entryOption = entryArg === undefined ? "" : ` --entry ${entryArg}`;
    console.error(`rebuild it with: rim-plugin-bundle --in-place${entryOption} ${pluginArg}`);
    process.exit(1);
  }
  console.log(`${manifest.plugin_id}: ${BUILT_ENTRY} and panels/ match a fresh build`);
}

/** True when `dir` looks like this script's output: a manifest pointing at main.mjs. */
function isBundle(dir) {
  try {
    const previous = JSON.parse(readFileSync(join(dir, "rim-plugin.json"), "utf8"));
    return previous.entrypoint === BUILT_ENTRY && existsSync(join(dir, BUILT_ENTRY));
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
