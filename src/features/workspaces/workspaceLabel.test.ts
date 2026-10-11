import { describe, it, expect } from "vitest";

import { ownerName, sameWorkspaceName, workspaceLabels } from "./workspaceLabel";

describe("workspaceLabels", () => {
  it("keeps a unique name plain and tells shared ones apart by owner, origin or both", () => {
    expect(
      workspaceLabels([
        { name: "Ops", ownerName: "Alice" },
        { name: "Design", ownerName: "Alice" },
        { name: "Design", ownerName: "Bob", origin: "rim.example.org" },
        { name: "Design", origin: "rim.other.org" },
      ]),
    ).toEqual([
      "Ops",
      "Design (Alice)",
      "Design (Bob, on rim.example.org)",
      "Design (on rim.other.org)",
    ]);
  });

  it("matches names trimmed and case-insensitively", () => {
    expect(
      workspaceLabels([
        { name: "Design", ownerName: "Alice" },
        { name: " design", ownerName: "Bob" },
      ]),
    ).toEqual(["Design (Alice)", "design (Bob)"]);
    expect(sameWorkspaceName("Design ", "DESIGN")).toBe(true);
  });

  it("shows a remote workspace's origin even when its name is unique", () => {
    expect(
      workspaceLabels([{ name: "Ops", ownerName: "Alice", origin: "rim.example.org" }]),
    ).toEqual(["Ops (on rim.example.org)"]);
  });
});

describe("ownerName", () => {
  it("prefers the display name and falls back to the username", () => {
    expect(ownerName({ username: "alice", displayName: "Alice A." })).toBe("Alice A.");
    expect(ownerName({ username: "alice", displayName: null })).toBe("alice");
    expect(ownerName({ username: "alice", displayName: "  " })).toBe("alice");
    expect(ownerName(null)).toBeNull();
  });
});
