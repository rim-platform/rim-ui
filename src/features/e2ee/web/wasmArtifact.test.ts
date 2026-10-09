import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { wasmSourceHash } from "../../../../scripts/wasm-sources.mjs";

describe("the committed MLS module", () => {
  it("is built from the crate sources in this tree (otherwise run `npm run build:wasm`)", () => {
    const recorded = JSON.parse(
      readFileSync(join(process.cwd(), "src/features/e2ee/wasm/source.json"), "utf8"),
    ) as { sourceSha256: string; wasmBytes: number };
    expect(wasmSourceHash(process.cwd())).toBe(recorded.sourceSha256);
    const wasm = readFileSync(join(process.cwd(), "src/features/e2ee/wasm/rim_mls_wasm_bg.wasm"));
    expect(wasm.length).toBe(recorded.wasmBytes);
  });
});
