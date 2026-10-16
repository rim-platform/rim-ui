// Version check: fails when package.json, package-lock.json, src-tauri/Cargo.toml, the rim-ui
// entry of src-tauri/Cargo.lock and src-tauri/tauri.conf.json do not record one version.
//
//   npm run version:check
//
// Exit status: 0 when they agree, 1 when they do not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { recordedVersions, versionMismatch } from "./versions.mjs";

const ROOT = new URL("..", import.meta.url);

/** The contents of every file that records the version, from the repository at `root`. */
export function readVersionFiles(root = ROOT) {
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  return {
    packageJson: read("package.json"),
    packageLock: read("package-lock.json"),
    cargoToml: read("src-tauri/Cargo.toml"),
    cargoLock: read("src-tauri/Cargo.lock"),
    tauriConf: read("src-tauri/tauri.conf.json"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = recordedVersions(readVersionFiles());
  const mismatch = versionMismatch(entries);
  if (mismatch) {
    console.error(mismatch);
    process.exit(1);
  }
  console.log(`version ${entries[0].version}: ${entries.map((e) => e.source).join(", ")} agree`);
}
