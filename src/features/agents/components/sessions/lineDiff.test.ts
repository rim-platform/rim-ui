import { describe, expect, it } from "vitest";

import { lineDiff } from "./lineDiff";

describe("lineDiff", () => {
  it("marks a changed line removed then added between kept lines", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  it("shows a new file as added lines", () => {
    expect(lineDiff(null, "x\ny")).toEqual([
      { kind: "added", text: "x" },
      { kind: "added", text: "y" },
    ]);
  });

  it("keeps the lines both share inside a change", () => {
    expect(lineDiff("1\n2\n3\n4", "1\nx\n3\ny")).toEqual([
      { kind: "same", text: "1" },
      { kind: "removed", text: "2" },
      { kind: "added", text: "x" },
      { kind: "same", text: "3" },
      { kind: "removed", text: "4" },
      { kind: "added", text: "y" },
    ]);
  });

  it("shows nothing changed for the same text", () => {
    expect(lineDiff("a\r\nb", "a\nb").every((line) => line.kind === "same")).toBe(true);
  });

  it("falls back to removed then added for a change too large to match", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join("\n");
    const lines = lineDiff(before, after);
    expect(lines).toHaveLength(6000);
    expect(lines[0]).toEqual({ kind: "removed", text: "old 0" });
    expect(lines[3000]).toEqual({ kind: "added", text: "new 0" });
  });
});
