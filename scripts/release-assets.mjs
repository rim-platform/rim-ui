// Release assets for the desktop bundles in one directory: the updater's `latest.json`, a
// `SHA256SUMS` over every bundle, and the download table for the release notes.
//
//   node scripts/release-assets.mjs <dir> <version> <owner/repo>
//
// <dir> holds the bundles the release workflow built and their `.sig` files, and nothing else.
// The script writes `latest.json` and `SHA256SUMS` into it and prints the download table (GitHub
// Markdown) on stdout. It fails when a file is not a known bundle, a bundle the updater can
// install has no signature, or a platform in REQUIRED_PLATFORMS has no default bundle.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bundles a release carries, by file name suffix. `installer` is the updater's name for the
 * bundle type an installed app updates itself with: an app installed from a .deb looks up
 * `linux-x86_64-deb` in `latest.json` first, then `linux-x86_64`. `default` marks the bundle
 * that plain `<os>-<arch>` key points at.
 */
export const BUNDLES = [
  {
    suffix: ".AppImage",
    os: "linux",
    kind: "AppImage, any distribution",
    installer: "appimage",
    default: true,
  },
  { suffix: ".deb", os: "linux", kind: "Debian, Ubuntu", installer: "deb" },
  { suffix: ".rpm", os: "linux", kind: "Fedora, openSUSE", installer: "rpm" },
  { suffix: "-setup.exe", os: "windows", kind: "installer", installer: "nsis", default: true },
  { suffix: ".msi", os: "windows", kind: "MSI, for managed installs", installer: "msi" },
  { suffix: ".dmg", os: "darwin", kind: "disk image" },
  { suffix: ".app.tar.gz", os: "darwin", kind: "update archive", installer: "app", default: true },
];

/** The `<os>-<arch>` keys `latest.json` must have: one per desktop build of the release. */
export const REQUIRED_PLATFORMS = ["linux-x86_64", "windows-x86_64"];

/** The files this script and the release workflow add to the directory; read as no bundle. */
const OUTPUTS = ["latest.json", "SHA256SUMS", "SHA256SUMS.sigstore"];

const OS_NAMES = { linux: "Linux", windows: "Windows", darwin: "macOS" };

/** File name tokens for each architecture; `universal` is a macOS build for both. */
const ARCH_TOKENS = [
  { pattern: /(^|[._-])(amd64|x64|x86_64)([._-]|$)/, arches: ["x86_64"] },
  { pattern: /(^|[._-])(aarch64|arm64)([._-]|$)/, arches: ["aarch64"] },
  { pattern: /(^|[._-])universal([._-]|$)/, arches: ["x86_64", "aarch64"] },
];

/** The bundle type and architectures of a file name, or `null` when it is not a bundle. */
export function classify(name) {
  const bundle = BUNDLES.find((b) => name.endsWith(b.suffix));
  if (!bundle) return null;
  const arch = ARCH_TOKENS.find((a) => a.pattern.test(name.slice(0, -bundle.suffix.length)));
  if (!arch) throw new Error(`${name}: no architecture in the file name`);
  return { ...bundle, arches: arch.arches };
}

/**
 * The bundles in `dir`, each `{ name, size, sha256, signature, bundle }` with `signature` the
 * text of its `.sig` file or `null`, in BUNDLES order. Throws on any other file, except the
 * release's own OUTPUTS, and on a `.sig` without its bundle.
 */
export function readBundles(dir) {
  const names = readdirSync(dir)
    .filter((name) => !OUTPUTS.includes(name))
    .sort();
  const bundles = [];
  for (const name of names) {
    if (name.endsWith(".sig")) {
      if (!names.includes(name.slice(0, -4))) throw new Error(`${name}: no bundle for it`);
      continue;
    }
    const bundle = classify(name);
    if (!bundle) throw new Error(`${name}: not a desktop bundle`);
    const path = join(dir, name);
    const data = readFileSync(path);
    const sigName = `${name}.sig`;
    bundles.push({
      name,
      size: statSync(path).size,
      sha256: createHash("sha256").update(data).digest("hex"),
      signature: names.includes(sigName) ? readFileSync(join(dir, sigName), "utf8").trim() : null,
      bundle,
    });
  }
  const order = (b) => BUNDLES.indexOf(BUNDLES.find((x) => x.suffix === b.bundle.suffix));
  return bundles.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** Where a release's asset is downloaded from. */
export function assetUrl(repo, version, name) {
  return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`;
}

/**
 * The Tauri updater's static manifest: the version, a link to the release as notes, and the URL
 * and signature text of a bundle under `<os>-<arch>-<installer>` for every bundle the updater
 * installs, and under `<os>-<arch>` for each platform's default bundle.
 */
export function latestJson(bundles, { version, repo, pubDate }) {
  const platforms = {};
  const add = (key, b) => {
    if (platforms[key]) throw new Error(`${key}: two bundles, ${b.name} and another`);
    platforms[key] = { signature: b.signature, url: assetUrl(repo, version, b.name) };
  };
  for (const b of bundles.filter((x) => x.bundle.installer)) {
    if (!b.signature) throw new Error(`${b.name}: no .sig file; the updater cannot verify it`);
    for (const arch of b.bundle.arches) {
      add(`${b.bundle.os}-${arch}-${b.bundle.installer}`, b);
      if (b.bundle.default) add(`${b.bundle.os}-${arch}`, b);
    }
  }
  const missing = REQUIRED_PLATFORMS.filter((p) => !platforms[p]);
  if (missing.length > 0) throw new Error(`no default bundle for ${missing.join(", ")}`);
  return {
    version,
    notes: `https://github.com/${repo}/releases/tag/v${version}`,
    pub_date: pubDate,
    platforms,
  };
}

/** `sha256sum` output over every bundle, which `sha256sum -c` checks. */
export function sha256sums(bundles) {
  return [...bundles]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((b) => `${b.sha256}  ${b.name}\n`)
    .join("");
}

function megabytes(size) {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** The release notes' table of downloads: file, platform and size. */
export function downloadTable(bundles, { version, repo }) {
  const rows = bundles.map((b) => {
    const platform = `${OS_NAMES[b.bundle.os]} ${b.bundle.arches.join(", ")} (${b.bundle.kind})`;
    const link = `[${b.name}](${assetUrl(repo, version, b.name)})`;
    return `| ${link} | ${platform} | ${megabytes(b.size)} |`;
  });
  return ["| File | Platform | Size |", "| --- | --- | --- |", ...rows].join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, version, repo] = process.argv.slice(2);
  if (!dir || !version || !repo) {
    console.error("usage: node scripts/release-assets.mjs <dir> <version> <owner/repo>");
    process.exit(2);
  }
  try {
    const bundles = readBundles(dir);
    const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const latest = latestJson(bundles, { version, repo, pubDate });
    writeFileSync(join(dir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
    writeFileSync(join(dir, "SHA256SUMS"), sha256sums(bundles));
    process.stdout.write(downloadTable(bundles, { version, repo }));
  } catch (e) {
    console.error(`release-assets: ${e.message}`);
    process.exit(1);
  }
}
