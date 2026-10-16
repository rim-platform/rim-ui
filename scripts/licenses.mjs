// Third-party licence notices: the Rust crates of src-tauri (cargo-about) and the npm production
// dependencies (license-checker-rseidelsohn), in one text file the desktop app bundles and each
// release attaches.
//
//   npm run licenses          writes src-tauri/resources/THIRD-PARTY-LICENSES.txt
//   npm run licenses:check    the same checks, writes nothing
//
// Both sides accept only the licences listed in src-tauri/about.toml. Exit status: 0 when every
// dependency is accepted, 1 when one is not (or its licence is unknown), 2 when the run failed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { init as checkNpmLicences } from "license-checker-rseidelsohn";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TAURI_DIR = join(ROOT, "src-tauri");
const ABOUT_CONFIG = join(TAURI_DIR, "about.toml");
const OUTPUT = join(TAURI_DIR, "resources", "THIRD-PARTY-LICENSES.txt");
const RULE = "=".repeat(78);
const THIN_RULE = "-".repeat(78);

class LicenceError extends Error {}

/** The `accepted` list of about.toml, shared by the Rust and the npm check. */
function acceptedLicences() {
  const config = readFileSync(ABOUT_CONFIG, "utf8");
  const list = /^accepted\s*=\s*\[([\s\S]*?)\]/m.exec(config);
  if (!list) throw new Error(`no accepted list in ${ABOUT_CONFIG}`);
  return new Set([...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** Whether the SPDX expression `expr` can be taken under the accepted licences. */
function expressionAccepted(expr, accepted) {
  const tokens = expr
    .replace(/[()]/g, (p) => ` ${p} `)
    .trim()
    .split(/\s+/);
  let at = 0;
  const primary = () => {
    if (tokens[at] === "(") {
      at += 1;
      const inner = either();
      if (tokens[at] !== ")") throw new LicenceError(`unbalanced licence expression: ${expr}`);
      at += 1;
      return inner;
    }
    let id = tokens[at++];
    if (tokens[at] === "WITH") {
      id = `${id} WITH ${tokens[at + 1]}`;
      at += 2;
    }
    return id !== undefined && accepted.has(id);
  };
  const both = () => {
    let ok = primary();
    while (tokens[at] === "AND") {
      at += 1;
      ok = primary() && ok;
    }
    return ok;
  };
  const either = () => {
    let ok = both();
    while (tokens[at] === "OR") {
      at += 1;
      ok = both() || ok;
    }
    return ok;
  };
  const ok = either();
  return ok && at === tokens.length;
}

/** cargo-about's grouped licences of the workspace's third-party crates; it refuses others. */
function rustLicences() {
  try {
    execFileSync("cargo", ["about", "--version"], { stdio: "ignore" });
  } catch (err) {
    throw new Error(
      "cargo-about is not installed: cargo install cargo-about --locked --features cli",
      { cause: err },
    );
  }
  let json;
  try {
    json = execFileSync(
      "cargo",
      ["about", "generate", "--workspace", "--locked", "--fail", "--format", "json"],
      {
        cwd: TAURI_DIR,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } catch (err) {
    throw new LicenceError("cargo-about refused the Rust dependencies (see above)", {
      cause: err,
    });
  }
  const groups = [];
  for (const licence of JSON.parse(json).licenses) {
    // Path crates are this workspace's own.
    const users = licence.used_by
      .map((u) => u.crate)
      .filter((c) => c.source)
      .map((c) => `${c.name} ${c.version}`);
    if (users.length > 0) groups.push({ name: licence.name, text: licence.text, users });
  }
  return groups;
}

/** The npm production dependencies, refused unless every licence is accepted. */
async function npmLicences(accepted) {
  const packages = await new Promise((resolve, reject) =>
    checkNpmLicences(
      { start: ROOT, production: true, excludePrivatePackages: true },
      (err, found) => (err ? reject(err) : resolve(found)),
    ),
  );
  const refused = [];
  const byText = new Map();
  for (const [id, info] of Object.entries(packages)) {
    const licences = Array.isArray(info.licenses) ? info.licenses.join(" AND ") : info.licenses;
    // A trailing `*` marks a licence guessed from a file rather than declared.
    if (!licences || licences.includes("*") || !expressionAccepted(licences, accepted)) {
      refused.push(`${id}: ${licences ?? "UNKNOWN"}`);
      continue;
    }
    const file = info.licenseFile && /^(licen[cs]e|copying)/i.test(basename(info.licenseFile));
    let text = file
      ? readFileSync(info.licenseFile, "utf8").trim()
      : `Licensed under ${licences}; the package carries no licence file.`;
    for (const notice of noticeFiles(info.path))
      text += `\n\n${readFileSync(notice, "utf8").trim()}`;
    const group = byText.get(text) ?? { name: licences, text, users: [] };
    group.users.push(id.replace(/@([^@]+)$/, " $1"));
    byText.set(text, group);
  }
  if (refused.length > 0) {
    throw new LicenceError(
      `npm dependencies with a licence not accepted:\n  ${refused.join("\n  ")}`,
    );
  }
  return [...byText.values()];
}

/** The NOTICE files a package ships, which its Apache-2.0 licence asks to pass on. */
function noticeFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^notice/i.test(f))
    .map((f) => join(dir, f));
}

function section(title, groups) {
  const sorted = groups
    .map((g) => ({ ...g, users: [...g.users].sort() }))
    .sort((a, b) => a.users[0].localeCompare(b.users[0]));
  const parts = [`${RULE}\n${title}\n${RULE}`];
  for (const group of sorted) {
    parts.push(
      `${THIN_RULE}\n${group.name}\nUsed by: ${group.users.join(", ")}\n${THIN_RULE}\n\n${group.text.trim()}`,
    );
  }
  return parts.join("\n\n");
}

function notices(rust, npm) {
  const header = [
    "RIM third-party software notices",
    "",
    "The RIM desktop app and web app include the third-party software listed below, each",
    "under the licence shown with it. RIM itself is licensed under Apache-2.0.",
  ].join("\n");
  return (
    [
      header,
      section("Rust crates (desktop app, and the web app's encryption module)", rust),
      section("npm packages (the app's user interface)", npm),
    ].join("\n\n\n") + "\n"
  );
}

async function main() {
  const check = process.argv.includes("--check");
  const accepted = acceptedLicences();
  const rust = rustLicences();
  const npm = await npmLicences(accepted);
  const text = notices(rust, npm);
  const crates = new Set(rust.flatMap((g) => g.users)).size;
  const packages = new Set(npm.flatMap((g) => g.users)).size;
  if (check) {
    console.log(`licences accepted: ${crates} crates, ${packages} npm packages`);
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, text);
  console.log(`wrote ${OUTPUT}: ${crates} crates, ${packages} npm packages`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof LicenceError ? err.message : err);
    process.exit(err instanceof LicenceError ? 1 : 2);
  });
}
