import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import { generateProtocol, OUTPUT_PATH, SCHEMA_PATH } from "../scripts/generate-protocol.ts";
import type * as wire from "../src/generated/protocol.ts";
import { ErrorCode, MAX_FRAME_BYTES, Method } from "../src/generated/protocol.ts";
import type { CommandOutput, Principal } from "../src/index.ts";

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

describe("generated protocol types", () => {
  it("are up to date with the schema (run npm run sdk:generate)", () => {
    expect(readFileSync(OUTPUT_PATH, "utf8")).toBe(generateProtocol(schema));
  });

  it("carry the schema's error codes, frame limit and methods", () => {
    const codes = Object.entries(schema["x-errorCodes"] as Record<string, string>).map(
      ([code, text]) => [text.split(":")[0], Number(code)],
    );
    expect(Object.entries(ErrorCode)).toEqual(codes);
    expect(MAX_FRAME_BYTES).toBe(schema["x-framing"].maxFrameBytes);

    const methods = new Set<string>();
    for (const def of Object.values(
      schema.$defs as Record<string, { properties?: { method?: { const?: string } } }>,
    )) {
      const method = def.properties?.method?.const;
      if (method) methods.add(method);
    }
    expect(new Set(Object.values(Method))).toEqual(methods);
  });

  it("let SDK values go on the wire unchanged", () => {
    expectTypeOf<Principal>().toExtend<wire.Principal>();
    expectTypeOf<CommandOutput>().toExtend<wire.CommandResult>();
  });
});
