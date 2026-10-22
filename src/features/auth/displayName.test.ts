import { describe, expect, it } from "vitest";

import { checkDisplayName } from "./displayName";

describe("checkDisplayName", () => {
  it("accepts a blank name and one of at most 64 characters after trimming", () => {
    for (const name of ["", "   ", "a".repeat(64), `  ${"a".repeat(64)}  `]) {
      expect(checkDisplayName(name)).toBeNull();
    }
  });

  it("refuses a name of 65 characters", () => {
    expect(checkDisplayName("a".repeat(65))).toBe("Display name must be at most 64 characters.");
  });

  it("counts characters, not UTF-16 units, as the server does", () => {
    expect(checkDisplayName("🎉".repeat(64))).toBeNull();
    expect(checkDisplayName("🎉".repeat(65))).not.toBeNull();
  });
});
