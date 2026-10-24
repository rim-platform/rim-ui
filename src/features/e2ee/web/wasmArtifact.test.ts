import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WASM_MODULES, wasmSourceHash } from "../../../../scripts/wasm-sources.mjs";

describe.each(WASM_MODULES)("the committed $crate module", (module) => {
  it("is built from the crate sources in this tree (otherwise run `npm run build:wasm`)", () => {
    const dir = join(process.cwd(), module.outDir);
    const recorded = JSON.parse(readFileSync(join(dir, "source.json"), "utf8")) as {
      sourceSha256: string;
      wasmBytes: number;
    };
    expect(wasmSourceHash(module, process.cwd())).toBe(recorded.sourceSha256);
    const wasm = readFileSync(join(dir, `${module.outName}_bg.wasm`));
    expect(wasm.length).toBe(recorded.wasmBytes);
  });
});
