// Sets the app's version everywhere it is recorded and cuts CHANGELOG.md for it: `Unreleased`
// becomes `[<version>] - <today>` under a new empty `Unreleased`.
//
//   npm run version:set -- <version>   e.g. 0.0.2
//
// When the files already carry <version>, only the changelog is cut. Refuses a version lower
// than the current one, and a version CHANGELOG.md already has a section for; nothing is
// written then.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readVersionFiles } from "./version-check.mjs";
import {
  compareVersions,
  cutChangelog,
  isVersion,
  recordedVersions,
  setCargoLockVersion,
  setCargoTomlVersion,
  versionMismatch,
} from "./versions.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const path = (p) => new URL(p, new URL("..", import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const version = process.argv[2];
if (!isVersion(version)) {
  fail("usage: npm run version:set -- <major>.<minor>.<patch>[-<pre-release>]");
}

const files = readVersionFiles();
const current = recordedVersions(files)[0].version;
if (isVersion(current) && compareVersions(version, current) < 0) {
  fail(`${version} is lower than the current version ${current}`);
}

const today = new Date().toISOString().slice(0, 10);
let changelog;
try {
  changelog = cutChangelog(readFileSync(path("CHANGELOG.md"), "utf8"), version, today);
} catch (e) {
  fail(e.message);
}

if (version !== current) {
  // npm writes both version fields of package.json and package-lock.json.
  execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  writeFileSync(path("src-tauri/Cargo.toml"), setCargoTomlVersion(files.cargoToml, version));
  writeFileSync(path("src-tauri/Cargo.lock"), setCargoLockVersion(files.cargoLock, version));
}
writeFileSync(path("CHANGELOG.md"), changelog);

const mismatch = versionMismatch(recordedVersions(readVersionFiles()));
if (mismatch) fail(mismatch);
console.log(`version ${version}; CHANGELOG.md cut as [${version}] - ${today}`);
