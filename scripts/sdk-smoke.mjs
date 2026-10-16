// Plugin SDK smoke test: packs @rim-platform/plugin-sdk as npm would publish it, installs the
// tarball into a copy of plugins/template-ts outside the repository, and type-checks, tests, runs
// and bundles the copy there, so the plugin sees only what the package ships. The TypeScript,
// Vitest, @types/node and esbuild of this repository are linked into the copy instead of
// installed, so the run needs no network.
//
//   npm run sdk:smoke
//
// Exit status: 0 when the copy type-checks, passes its tests, starts and bundles; 1 otherwise.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SDK_DIR = join(ROOT, "sdk/plugin-sdk");
const TEMPLATE_DIR = join(ROOT, "plugins/template-ts");
const TOOLCHAIN = ["typescript", "vitest", "@types/node", "esbuild"];

/** Run npm: the npm that started this script when there is one, else the one on PATH. */
function npm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith(".js")) {
    execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: "inherit" });
  } else {
    execFileSync("npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  }
}

function node(args, cwd) {
  execFileSync(process.execPath, args, { cwd, stdio: "inherit" });
}

/** Link `name` from this repository's node_modules into `dir`'s, as if installed there. */
function linkPackage(dir, name) {
  const target = join(ROOT, "node_modules", name);
  if (!existsSync(target)) throw new Error(`${name} is not installed: run npm ci first`);
  const link = join(dir, "node_modules", name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

const work = mkdtempSync(join(tmpdir(), "rim-sdk-smoke-"));
const inRepo = !relative(ROOT, work).startsWith("..");
if (inRepo) {
  console.error(`the temporary folder ${work} is inside the repository: set TMPDIR elsewhere`);
  process.exit(1);
}
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

try {
  // `npm pack` runs the package's prepack, which builds dist/.
  npm(["pack", "--pack-destination", work], SDK_DIR);
  const tarball = readdirSync(work).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack wrote no tarball into ${work}`);

  const plugin = join(work, "template-ts");
  cpSync(TEMPLATE_DIR, plugin, {
    recursive: true,
    filter: (source) => !["dist", "node_modules"].includes(relative(TEMPLATE_DIR, source)),
  });
  const manifest = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
  manifest.devDependencies = {
    "@rim-platform/plugin-sdk": `file:${resolve(work, tarball)}`,
  };
  writeFileSync(join(plugin, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  npm(["install", "--offline", "--no-audit", "--no-fund"], plugin);
  for (const name of TOOLCHAIN) linkPackage(plugin, name);

  node([join(plugin, "node_modules/typescript/bin/tsc"), "-p", plugin], plugin);
  node([join(plugin, "node_modules/vitest/vitest.mjs"), "run"], plugin);
  // Unbundled, as the host starts it: the SDK loads from node_modules, and the
  // plugin exits once its stdin closes.
  execFileSync(process.execPath, [join(plugin, "main.ts")], { cwd: plugin, input: "" });
  const bin = join(plugin, "node_modules/@rim-platform/plugin-sdk/dist/scripts/bundle-plugin.mjs");
  node([bin, "."], plugin);
  const built = JSON.parse(
    readFileSync(join(plugin, "dist/dev.example.template-ts/rim-plugin.json"), "utf8"),
  );
  if (built.entrypoint !== "main.mjs") throw new Error("the bundled manifest is not main.mjs");
  console.log(
    `sdk smoke: ${tarball} type-checks, tests, runs and bundles the template outside rim-ui`,
  );
} catch (error) {
  console.error(`sdk smoke failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
