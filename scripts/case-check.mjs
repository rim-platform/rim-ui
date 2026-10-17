// Case check: fails when two tracked names in one folder differ only in case, which a
// case-insensitive filesystem (Windows, macOS by default) cannot tell apart. Module files are
// compared without their extension too, since an import names them that way.
//
//   npm run case:check
//
// Exit status: 0 when no names collide, 1 when some do.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_EXTENSION = /(?:\.d)?\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/**
 * The groups of `paths` that collide by case: each group lists the colliding files or folders,
 * sorted, and the groups are sorted by their first entry.
 */
export function caseCollisions(paths) {
  // folder, lowercased name → name as written → the file or folder path it stands for
  const names = new Map();
  const add = (folder, name, path) => {
    const key = `${folder.toLowerCase()}/${name.toLowerCase()}`;
    const spellings = names.get(key) ?? new Map();
    if (!spellings.has(name)) spellings.set(name, new Set());
    spellings.get(name).add(path);
    names.set(key, spellings);
  };
  for (const path of paths) {
    const segments = path.split("/");
    for (let i = 0; i < segments.length; i++) {
      const folder = segments.slice(0, i).join("/");
      const entry = segments.slice(0, i + 1).join("/");
      add(folder, segments[i], entry);
      if (i === segments.length - 1 && MODULE_EXTENSION.test(segments[i])) {
        add(folder, segments[i].replace(MODULE_EXTENSION, ""), entry);
      }
    }
  }
  const groups = [];
  for (const spellings of names.values()) {
    if (spellings.size < 2) continue;
    groups.push([...new Set([...spellings.values()].flatMap((set) => [...set]))].sort());
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((path) => path.length > 0);
  const groups = caseCollisions(tracked);
  if (groups.length > 0) {
    console.error("names that differ only in case, which Windows and macOS cannot tell apart:");
    for (const group of groups) console.error(`  ${group.join("  ")}`);
    process.exit(1);
  }
  console.log(`${tracked.length} tracked files: no names differ only in case`);
}
