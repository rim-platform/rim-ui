// The app's version as the files that carry it record it, and the CHANGELOG.md cut that starts a
// release. Pure functions over file contents; version-check.mjs and version-set.mjs do the I/O.

/** The Cargo package (and Cargo.lock entry) of the desktop app. */
export const CARGO_PACKAGE = "rim-ui";

/** tauri.conf.json's `version`: read from package.json at build time. */
export const TAURI_VERSION_SOURCE = "../package.json";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** Whether `version` is `<major>.<minor>.<patch>[-<pre-release>]` (no build metadata). */
export function isVersion(version) {
  return typeof version === "string" && SEMVER.test(version);
}

/** Semantic Versioning precedence: negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareVersions(a, b) {
  const [ma, mb] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!ma || !mb) throw new Error(`not a version: ${!ma ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return Math.sign(d);
  }
  const [pa, pb] = [ma[4], mb[4]];
  if (pa === undefined || pb === undefined) {
    if (pa === pb) return 0;
    return pa === undefined ? 1 : -1;
  }
  const [ia, ib] = [pa.split("."), pb.split(".")];
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const [na, nb] = [/^\d+$/.test(ia[i]), /^\d+$/.test(ib[i])];
    if (na && nb) {
      const d = Number(ia[i]) - Number(ib[i]);
      if (d !== 0) return Math.sign(d);
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1;
    }
  }
  return 0;
}

/** The `[package]` table of a Cargo.toml: its start and end offsets. */
function packageTable(text) {
  const start = text.search(/^\[package\][ \t]*$/m);
  if (start < 0) throw new Error("Cargo.toml has no [package] table");
  const rest = text.slice(start + 1);
  const next = rest.search(/^\[/m);
  return { start, end: next < 0 ? text.length : start + 1 + next };
}

const TOML_VERSION = /^version[ \t]*=[ \t]*"([^"]*)"/m;

/** `version` under `[package]` in a Cargo.toml. */
export function cargoTomlVersion(text) {
  const { start, end } = packageTable(text);
  const match = TOML_VERSION.exec(text.slice(start, end));
  if (!match) throw new Error("Cargo.toml has no version under [package]");
  return match[1];
}

/** The Cargo.toml with `version` under `[package]` set to `version`. */
export function setCargoTomlVersion(text, version) {
  cargoTomlVersion(text);
  const { start, end } = packageTable(text);
  const table = text.slice(start, end).replace(TOML_VERSION, `version = "${version}"`);
  return text.slice(0, start) + table + text.slice(end);
}

function lockEntry(name) {
  return new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")([^"]*)(")`);
}

/** The version of the package `name` in a Cargo.lock. */
export function cargoLockVersion(text, name = CARGO_PACKAGE) {
  const match = lockEntry(name).exec(text);
  if (!match) throw new Error(`Cargo.lock has no package ${name}`);
  return match[2];
}

/** The Cargo.lock with only the entry of the package `name` set to `version`. */
export function setCargoLockVersion(text, version, name = CARGO_PACKAGE) {
  cargoLockVersion(text, name);
  return text.replace(lockEntry(name), (_, head, _old, tail) => `${head}${version}${tail}`);
}

/**
 * Every place the version is recorded, as `{ source, version }`, from the files' contents:
 * `packageJson`, `packageLock`, `cargoToml`, `cargoLock` and `tauriConf` (strings).
 */
export function recordedVersions({ packageJson, packageLock, cargoToml, cargoLock, tauriConf }) {
  const pkg = JSON.parse(packageJson);
  const lock = JSON.parse(packageLock);
  const tauri = JSON.parse(tauriConf);
  const entries = [
    { source: "package.json", version: pkg.version },
    { source: "package-lock.json (version)", version: lock.version },
    { source: 'package-lock.json (packages[""].version)', version: lock.packages?.[""]?.version },
    { source: "src-tauri/Cargo.toml", version: cargoTomlVersion(cargoToml) },
    { source: `src-tauri/Cargo.lock (${CARGO_PACKAGE})`, version: cargoLockVersion(cargoLock) },
  ];
  if (tauri.version !== TAURI_VERSION_SOURCE) {
    entries.push({ source: "src-tauri/tauri.conf.json", version: tauri.version });
  }
  return entries;
}

/** A message naming every disagreeing or invalid version, or `null` when all agree. */
export function versionMismatch(entries) {
  const expected = entries[0].version;
  const valid = entries.every((e) => isVersion(e.version));
  const agree = entries.every((e) => e.version === expected);
  if (valid && agree) return null;
  const lines = entries.map((e) => `  ${e.source}: ${e.version ?? "(missing)"}`);
  const fix = "Set them all with: npm run version:set -- <version>";
  return [
    agree
      ? "The version is not <major>.<minor>.<patch>[-<pre-release>]:"
      : "The versions disagree:",
    ...lines,
    fix,
  ].join("\n");
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * CHANGELOG.md with `## [Unreleased]` renamed to `## [<version>] - <date>` under a new empty
 * `## [Unreleased]`, and the link references at the bottom following it: `[Unreleased]` compares
 * from the new tag, and `[<version>]` compares from the previous release, or points at its tag
 * when it is the first. Throws when the section exists already or `Unreleased` is missing or
 * empty.
 */
export function cutChangelog(text, version, date) {
  if (!isVersion(version)) throw new Error(`not a version: ${version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not a date: ${date}`);
  if (new RegExp(`^## \\[${escape(version)}\\]`, "m").test(text)) {
    throw new Error(`CHANGELOG.md already has a section [${version}]`);
  }
  const heading = /^## \[Unreleased\][ \t]*$/m.exec(text);
  if (!heading) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const after = text.slice(heading.index + heading[0].length);
  const nextHeading = after.search(/^## /m);
  const body = (nextHeading < 0 ? after : after.slice(0, nextHeading))
    .split("\n")
    .filter((line) => !/^\[[^\]]+\]: /.test(line))
    .join("\n");
  if (!/\S/.test(body)) throw new Error("CHANGELOG.md has no entries under Unreleased");
  const previous = /^## \[([^\]]+)\]/m.exec(nextHeading < 0 ? "" : after.slice(nextHeading));

  let out =
    text.slice(0, heading.index) +
    `## [Unreleased]\n\n## [${version}] - ${date}` +
    text.slice(heading.index + heading[0].length);

  const link = /^\[Unreleased\]: (\S+)$/m.exec(out);
  if (link) {
    const base = link[1].replace(/\/(commits|compare)\/.*$/, "");
    const versionLink = previous
      ? `${base}/compare/v${previous[1]}...v${version}`
      : `${base}/releases/tag/v${version}`;
    out =
      out.slice(0, link.index) +
      `[Unreleased]: ${base}/compare/v${version}...HEAD\n[${version}]: ${versionLink}` +
      out.slice(link.index + link[0].length);
  }
  return out;
}
