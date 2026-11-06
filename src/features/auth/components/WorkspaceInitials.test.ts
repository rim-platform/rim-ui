import { describe, expect, it } from "vitest";

import { workspaceInitials } from "./WorkspaceInitials";

describe("workspaceInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(workspaceInitials("Halden Studio")).toBe("HS");
    expect(workspaceInitials("halden")).toBe("H");
    expect(workspaceInitials("a b c")).toBe("AB");
  });

  it("skips an emoji, whole, and a leading format mark", () => {
    expect(workspaceInitials("\u{1F680} Rocket Club")).toBe("RC");
    expect(workspaceInitials("\u200FHalden Studio")).toBe("HS");
  });

  it("falls back to a question mark", () => {
    expect(workspaceInitials("\u{1F680}")).toBe("?");
    expect(workspaceInitials("  ")).toBe("?");
  });
});
