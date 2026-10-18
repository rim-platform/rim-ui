// rim-plugin-bundle on a plugin folder that holds its own build, as a plugin
// repository commits it: --in-place writes main.mjs and --check compares it
// with a fresh build.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BUNDLER = join(import.meta.dirname, "../scripts/bundle-plugin.mjs");
type RuntimeKind = "WebSandboxed" | "DesktopLocalProcess";

/** A plugin repository: the manifest, `src/main.ts` and one panel, not built yet. */
function pluginRepo(runtimeKind: RuntimeKind, entrypoint = "main.mjs"): string {
  const dir = mkdtempSync(join(tmpdir(), "rim-plugin-repo-"));
  const manifest = {
    manifest_version: 1,
    plugin_id: "dev.example.check",
    display_name: "Check",
    version: "1.0.0",
    description: "A plugin folder that holds its own build.",
    runtime_kind: runtimeKind,
    entrypoint,
    panels: [{ id: "main", title: "Main", description: "The panel." }],
  };
  writeFileSync(join(dir, "rim-plugin.json"), JSON.stringify(manifest, null, 2));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src/main.ts"),
    'const greeting: string = "hi";\nconsole.log(greeting);\n',
  );
  mkdirSync(join(dir, "panels/main"), { recursive: true });
  writeFileSync(join(dir, "panels/main/index.html"), "<p>hi</p>\n");
  return dir;
}

function bundler(args: string[], cwd: string) {
  const run = spawnSync(process.execPath, [BUNDLER, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("rim-plugin-bundle", () => {
  it.each<RuntimeKind>(["WebSandboxed", "DesktopLocalProcess"])(
    "passes through a built %s folder by default and matches a build from source",
    (runtimeKind) => {
      const dir = pluginRepo(runtimeKind);
      expect(bundler(["--in-place", "--entry", "src/main.ts", dir], dir).status).toBe(0);

      const fromBuiltFolder = bundler([dir], tmpdir());
      expect(fromBuiltFolder).toMatchObject({ status: 0, stderr: "" });
      expect(fromBuiltFolder.stdout).toContain("using existing main.mjs without rebuilding");
      const bundlePath = join(dir, "dist/dev.example.check-1.0.0.rimbundle");
      const builtBundle = readFileSync(bundlePath);

      const fromSource = bundler(["--entry", "src/main.ts", dir], tmpdir());
      expect(fromSource).toMatchObject({ status: 0, stderr: "" });
      expect(readFileSync(bundlePath)).toEqual(builtBundle);
    },
    30_000,
  );

  it.each([
    { description: "a node: import", code: 'import { readFileSync } from "node:fs";\n' },
    { description: "a relative import", code: 'import "./helper.mjs";\n' },
  ])("rejects a built web plugin containing $description", ({ code }) => {
    const dir = pluginRepo("WebSandboxed");
    writeFileSync(join(dir, "main.mjs"), code);

    const result = bundler([dir], tmpdir());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "still imports something: a web plugin must bundle into one module",
    );
  });

  it("rejects a hashbang in a built web plugin without rewriting its entry", () => {
    const dir = pluginRepo("WebSandboxed");
    const source = '#!/usr/bin/env node\nconsole.log("hello");\n';
    writeFileSync(join(dir, "main.mjs"), source);

    const result = bundler([dir], tmpdir());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("starts with a hashbang");
    expect(readFileSync(join(dir, "main.mjs"), "utf8")).toBe(source);
  });
});

describe("rim-plugin-bundle --check", () => {
  it.each<RuntimeKind>(["WebSandboxed", "DesktopLocalProcess"])(
    "passes on a %s folder built in place, from any working directory",
    (runtimeKind) => {
      const dir = pluginRepo(runtimeKind);
      expect(bundler(["--in-place", "--entry", "src/main.ts", "."], dir).status).toBe(0);
      const check = bundler(["--check", "--entry", "src/main.ts", dir], tmpdir());
      expect(check).toMatchObject({ status: 0, stderr: "" });
      expect(check.stdout).toContain("main.mjs and panels/ match a fresh build");
    },
    30_000,
  );

  it("names a stale main.mjs and how to rebuild it", () => {
    const dir = pluginRepo("WebSandboxed");
    expect(bundler(["--in-place", "--entry", "src/main.ts", dir], dir).status).toBe(0);
    writeFileSync(join(dir, "main.mjs"), `${readFileSync(join(dir, "main.mjs"), "utf8")}\n`);
    const check = bundler(["--check", "--entry", "src/main.ts", dir], dir);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("main.mjs: differs from a fresh build");
    expect(check.stderr).toContain("rim-plugin-bundle --in-place --entry src/main.ts");
  }, 30_000);

  it("names a folder that does not hold a build", () => {
    const dir = pluginRepo("WebSandboxed", "src/main.ts");
    const check = bundler(["--check", dir], dir);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain(
      "rim-plugin.json: entrypoint is src/main.ts, a built plugin's is main.mjs",
    );
    expect(check.stderr).toContain("main.mjs: missing");
  }, 30_000);

  it("needs the source when the manifest points at main.mjs", () => {
    const check = bundler(["--check", pluginRepo("WebSandboxed")], tmpdir());
    expect(check.status).toBe(2);
    expect(check.stderr).toContain("name its source with --entry <file>");
  });
});
