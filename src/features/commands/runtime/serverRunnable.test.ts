import { describe, it, expect } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { runsOnServer, skippedUnattended } from "./serverRunnable";

describe("runsOnServer", () => {
  it("accepts a backend command and refuses a desktop-local one", () => {
    expect(runsOnServer({ executionTarget: "BACKEND" })).toBe(true);
    expect(runsOnServer({ executionTarget: "DESKTOP_LOCAL" })).toBe(false);
  });
});

describe("skippedUnattended", () => {
  it.each([
    [CommandSensitivity.SAFE, false, false],
    [CommandSensitivity.SENSITIVE, false, false],
    [CommandSensitivity.MUTATING, false, true],
    [CommandSensitivity.RESTRICTED, false, true],
    [CommandSensitivity.SAFE, true, true],
    [undefined, false, false],
  ])("sensitivity %s, dangerous %s: skipped %s", (sensitivity, dangerous, skipped) => {
    expect(skippedUnattended({ sensitivity, dangerous })).toBe(skipped);
  });
});
