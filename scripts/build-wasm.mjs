// Builds the web app's MLS module: `rim_mls_wasm` for wasm32-unknown-unknown (profile `wasm`),
// then `wasm-bindgen --target web` into `src/features/e2ee/wasm/`, and records the hash of the
// sources it was built from. Needs the `wasm32-unknown-unknown` target and wasm-bindgen-cli
// at the version `rim_mls_wasm` pins.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { wasmSourceHash } from "./wasm-sources.mjs";

const root = new URL("..", import.meta.url).pathname;
const tauri = `${root}src-tauri`;
const out = `${root}src/features/e2ee/wasm`;

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

run(
  "cargo",
  ["build", "-p", "rim_mls_wasm", "--target", "wasm32-unknown-unknown", "--profile", "wasm"],
  tauri,
);
run(
  "wasm-bindgen",
  [
    "--target",
    "web",
    "--out-dir",
    out,
    "--out-name",
    "rim_mls_wasm",
    `${tauri}/target/wasm32-unknown-unknown/wasm/rim_mls_wasm.wasm`,
  ],
  root,
);

const wasm = readFileSync(`${out}/rim_mls_wasm_bg.wasm`);
const source = {
  sourceSha256: wasmSourceHash(),
  wasmBytes: wasm.length,
  wasmGzipBytes: gzipSync(wasm, { level: 9 }).length,
};
writeFileSync(`${out}/source.json`, `${JSON.stringify(source, null, 2)}\n`);
console.log(`rim_mls_wasm: ${source.wasmBytes} bytes, ${source.wasmGzipBytes} gzipped (level 9)`);
