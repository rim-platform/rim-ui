// Builds the SDK's dist/ once before any test runs: the plugins and the app's
// conformance tests import the SDK by its package name, which resolves there.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default function buildSdk(): void {
  execFileSync(process.execPath, [join(import.meta.dirname, "../scripts/build.mjs")], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}
