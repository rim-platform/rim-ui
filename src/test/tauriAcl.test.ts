/**
 * The desktop app's command access list: the main window is granted exactly the app commands the
 * page calls, every granted command is one the app registers, and a registered command the page
 * does not call stays ungranted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Registered commands the page never calls, so the main window is not granted them. */
const NOT_GRANTED = ["plugin_install", "agent_validate_credentials"];

/** @returns The command names in the app's `generate_handler!` list, in order. */
function registeredCommands(): string[] {
  const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
  const start = lib.indexOf("tauri::generate_handler![");
  const end = lib.indexOf("])", start);
  expect(start).toBeGreaterThan(-1);
  return lib
    .slice(start + "tauri::generate_handler![".length, end)
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => path.split("::").pop() ?? path);
}

/** @returns The commands the `main-window` permission allows. */
function grantedCommands(): string[] {
  const toml = readFileSync(join(ROOT, "src-tauri/permissions/main-window.toml"), "utf8");
  const list = /commands\.allow\s*=\s*\[([^\]]*)\]/.exec(toml);
  expect(list).not.toBeNull();
  return [...(list?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

/** @returns The text of every non-test TypeScript source under `src`. */
function pageSources(): string[] {
  const texts: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "test") visit(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        texts.push(readFileSync(full, "utf8"));
      }
    }
  };
  visit(join(ROOT, "src"));
  return texts;
}

describe("the main window's command access list", () => {
  it("is granted to the main window", () => {
    const capability = JSON.parse(
      readFileSync(join(ROOT, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { windows: string[]; permissions: unknown[] };
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toContain("main-window");
  });

  it("grants only commands the app registers, each once", () => {
    const registered = new Set(registeredCommands());
    const granted = grantedCommands();
    expect(new Set(granted).size).toBe(granted.length);
    expect(granted.filter((command) => !registered.has(command))).toEqual([]);
  });

  it("grants every registered command but those the page never calls", () => {
    const granted = new Set(grantedCommands());
    expect(registeredCommands().filter((command) => !granted.has(command))).toEqual(NOT_GRANTED);
  });

  it("grants exactly the app commands the page names", () => {
    const sources = pageSources().join("\n");
    const named = (command: string) => new RegExp(`["'\`]${command}["'\`]`).test(sources);
    expect(grantedCommands().filter((command) => !named(command))).toEqual([]);
    expect(NOT_GRANTED.filter(named)).toEqual([]);
  });
});
