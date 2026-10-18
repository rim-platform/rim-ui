// rim-plugin-bundle on a plugin folder that holds its own build, as a plugin
// repository commits it: --in-place writes main.mjs, --check compares it with a
// fresh build, and a bundle without --entry takes it as it is.
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

describe("rim-plugin-bundle on a built folder", () => {
  it.each<RuntimeKind>(["WebSandboxed", "DesktopLocalProcess"])(
    "bundles a %s folder's main.mjs as the build from --entry src/main.ts does",
    (runtimeKind) => {
      const dir = pluginRepo(runtimeKind);
      expect(bundler(["--in-place", "--entry", "src/main.ts", "."], dir).status).toBe(0);
      const out = mkdtempSync(join(tmpdir(), "rim-plugin-out-"));

      const asItIs = bundler([dir, join(out, "built/dev.example.check")], tmpdir());
      expect(asItIs).toMatchObject({ status: 0, stderr: "" });
      expect(asItIs.stdout).toContain("using the built main.mjs as it is");
      const fromSource = bundler(
        ["--entry", "src/main.ts", dir, join(out, "source/dev.example.check")],
        tmpdir(),
      );
      expect(fromSource).toMatchObject({ status: 0, stderr: "" });
      expect(fromSource.stdout).not.toContain("as it is");

      const bundle = (from: string) =>
        readFileSync(join(out, from, "dev.example.check-1.0.0.rimbundle"));
      expect(bundle("built").equals(bundle("source"))).toBe(true);
    },
    30_000,
  );

  it("refuses a web main.mjs that starts with a hashbang", () => {
    const dir = pluginRepo("WebSandboxed");
    expect(bundler(["--in-place", "--entry", "src/main.ts", "."], dir).status).toBe(0);
    const built = readFileSync(join(dir, "main.mjs"), "utf8");
    writeFileSync(join(dir, "main.mjs"), `#!/usr/bin/env node\n${built}`);
    const result = bundler(["."], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("starts with a hashbang, which a web plugin cannot use");
  }, 30_000);

  it("copies main.mjs without building it again", () => {
    const dir = pluginRepo("DesktopLocalProcess");
    expect(bundler(["--in-place", "--entry", "src/main.ts", "."], dir).status).toBe(0);
    const edited = `${readFileSync(join(dir, "main.mjs"), "utf8")}// edited\n`;
    writeFileSync(join(dir, "main.mjs"), edited);
    expect(bundler(["."], dir).status).toBe(0);
    expect(readFileSync(join(dir, "dist/dev.example.check/main.mjs"), "utf8")).toBe(edited);
  }, 30_000);
});
