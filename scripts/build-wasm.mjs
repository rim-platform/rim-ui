// Builds the web app's WebAssembly modules (`WASM_MODULES`: MLS and OPAQUE): each crate for
// wasm32-unknown-unknown (profile `wasm`), on its own so the two never share features, then
// `wasm-bindgen --target web` into the module's directory, and records the hash of the sources
// it was built from. Paths under the cargo home, the rustup home and the repository are
// remapped, so the module's panic locations name no directory of the machine that built it.
// Needs the `wasm32-unknown-unknown` target and wasm-bindgen-cli at the version both facade
// crates pin.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { WASM_MODULES, wasmSourceHash } from "./wasm-sources.mjs";

const root = new URL("..", import.meta.url).pathname;
const tauri = `${root}src-tauri`;

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

// Rust flags as a list: the caller's RUSTFLAGS, then the target's flags from
// `src-tauri/.cargo/config.toml` (RUSTFLAGS replaces them, so they are repeated here), then the
// path remaps. Passed encoded, so a path with spaces stays one argument.
const remaps = {
  [resolve(process.env.CARGO_HOME ?? `${homedir()}/.cargo`)]: "/cargo",
  [resolve(process.env.RUSTUP_HOME ?? `${homedir()}/.rustup`)]: "/rustup",
  [resolve(root)]: "/rim-ui",
};
const rustflags = [
  ...(process.env.RUSTFLAGS ?? "").split(" ").filter(Boolean),
  "--cfg",
  'getrandom_backend="wasm_js"',
  ...Object.entries(remaps).map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
];
const cargoEnv = { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f") };
delete cargoEnv.RUSTFLAGS;

for (const module of WASM_MODULES) {
  const out = `${root}${module.outDir}`;
  run(
    "cargo",
    ["build", "-p", module.crate, "--target", "wasm32-unknown-unknown", "--profile", "wasm"],
    tauri,
    cargoEnv,
  );
  run(
    "wasm-bindgen",
    [
      "--target",
      "web",
      "--out-dir",
      out,
      "--out-name",
      module.outName,
      `${tauri}/target/wasm32-unknown-unknown/wasm/${module.crate}.wasm`,
    ],
    root,
  );

  const wasm = readFileSync(`${out}/${module.outName}_bg.wasm`);
  const source = {
    sourceSha256: wasmSourceHash(module),
    wasmBytes: wasm.length,
    wasmGzipBytes: gzipSync(wasm, { level: 9 }).length,
  };
  writeFileSync(`${out}/source.json`, `${JSON.stringify(source, null, 2)}\n`);
  console.log(
    `${module.crate}: ${source.wasmBytes} bytes, ${source.wasmGzipBytes} gzipped (level 9)`,
  );
}
