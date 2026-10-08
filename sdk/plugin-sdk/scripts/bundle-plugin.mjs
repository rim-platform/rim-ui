#!/usr/bin/env node
// Bundle a TypeScript plugin into a directory that installs by copying it into
// ~/.rim/plugins: rim-plugin.json, a single main.mjs with the SDK inside, and
// the plugin's panels/ folder if it has one. Needs esbuild.
//
// Usage: rim-plugin-bundle <plugin-dir> [out-dir]
// out-dir defaults to <plugin-dir>/dist/<plugin_id>.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const [pluginArg, outArg] = process.argv.slice(2);
if (!pluginArg) {
  console.error("usage: rim-plugin-bundle <plugin-dir> [out-dir]");
  process.exit(2);
}

const pluginDir = resolve(pluginArg);
const manifest = JSON.parse(readFileSync(join(pluginDir, "rim-plugin.json"), "utf8"));
const outDir = resolve(outArg ?? join(pluginDir, "dist", manifest.plugin_id));
const entry = join(pluginDir, manifest.entrypoint);
const outFile = join(outDir, "main.mjs");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

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

writeFileSync(
  join(outDir, "rim-plugin.json"),
  `${JSON.stringify({ ...manifest, entrypoint: "main.mjs" }, null, 2)}\n`,
);
if (existsSync(join(pluginDir, "panels"))) {
  cpSync(join(pluginDir, "panels"), join(outDir, "panels"), { recursive: true });
}

console.log(`bundled ${manifest.plugin_id} into ${outDir}`);
