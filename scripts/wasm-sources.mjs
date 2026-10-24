// The web app's WebAssembly modules, the crate sources each is built from, and their hash:
// `build-wasm.mjs` records it next to the module, and a test fails when the sources changed
// since.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Each module: the crate built, where wasm-bindgen writes it (relative to the repository root),
 * the name of its files, and the crates whose sources it hashes.
 */
export const WASM_MODULES = [
  {
    crate: "rim_mls_wasm",
    outDir: "src/features/e2ee/wasm",
    outName: "rim_mls_wasm",
    hashedCrates: ["src-tauri/crates/rim_mls", "src-tauri/crates/rim_mls_wasm"],
  },
  {
    crate: "rim_opaque_wasm",
    outDir: "src/features/auth/opaque/wasm",
    outName: "rim_opaque_wasm",
    hashedCrates: ["src-tauri/crates/rim_opaque", "src-tauri/crates/rim_opaque_wasm"],
  },
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/**
 * SHA-256 (hex) over each of the module's crates' `Cargo.toml` and `src/`, by path, in a fixed
 * order. `root` is the repository's root.
 */
export function wasmSourceHash(module, root = fileURLToPath(new URL("..", import.meta.url))) {
  const paths = module.hashedCrates
    .flatMap((crate) => [join(root, crate, "Cargo.toml"), ...files(join(root, crate, "src"))])
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(`${path}\n`);
    hash.update(readFileSync(join(root, path)));
    hash.update("\n");
  }
  return hash.digest("hex");
}
