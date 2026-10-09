// The sources the committed MLS module (`src/features/e2ee/wasm/`) is built from, and their
// hash: `build-wasm.mjs` records it, and a test fails when the sources changed since.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CRATES = ["src-tauri/crates/rim_mls", "src-tauri/crates/rim_mls_wasm"];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/**
 * SHA-256 (hex) over each crate's `Cargo.toml` and `src/`, by path, in a fixed order. `root` is
 * the repository's root.
 */
export function wasmSourceHash(root = fileURLToPath(new URL("..", import.meta.url))) {
  const paths = CRATES.flatMap((crate) => [
    join(root, crate, "Cargo.toml"),
    ...files(join(root, crate, "src")),
  ])
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
