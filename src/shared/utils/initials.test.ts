import { describe, expect, it } from "vitest";

import { firstLetter, workspaceInitials } from "./initials";

describe("firstLetter", () => {
  it("takes a whole letter, upper-cased", () => {
    expect(firstLetter("botland")).toBe("B");
    expect(firstLetter("Ärger")).toBe("Ä");
    expect(firstLetter("42 things")).toBe("4");
  });

  it("skips an emoji and its surrogate pair instead of splitting it", () => {
    expect(firstLetter("🚀 Botland")).toBe("B");
    expect(firstLetter("🚀 Botland")).not.toContain("�");
  });

  it("skips format marks and punctuation", () => {
    expect(firstLetter("‮evil")).toBe("E");
    expect(firstLetter("_x")).toBe("X");
  });

  it("falls back on a question mark without a letter or digit", () => {
    expect(firstLetter("")).toBe("?");
    expect(firstLetter("🚀🔥")).toBe("?");
  });
});

describe("workspaceInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(workspaceInitials("🚀 Botland Team Two")).toBe("BT");
    expect(workspaceInitials("solo")).toBe("S");
    expect(workspaceInitials("🚀")).toBe("?");
    expect(workspaceInitials("  ")).toBe("?");
    expect(workspaceInitials("a b c")).toBe("AB");
    expect(workspaceInitials("\u200FHalden Studio")).toBe("HS");
  });
});
