import { describe, expect, it } from "vitest";

import { COMMAND_CATEGORIES, compareCommandCategories } from "./commandCategories";

describe("compareCommandCategories", () => {
  it("puts the built-in categories in their fixed order, then the others alphabetically", () => {
    const names = ["Kubernetes Pods", "State", "Chat", "Navigation", "Admin", "Workspace", "App"];
    expect([...names].sort(compareCommandCategories)).toEqual([
      "Navigation",
      "Workspace",
      "App",
      "State",
      "Admin",
      "Chat",
      "Kubernetes Pods",
    ]);
  });

  it("keeps the fixed list in its own order", () => {
    expect([...COMMAND_CATEGORIES].reverse().sort(compareCommandCategories)).toEqual([
      ...COMMAND_CATEGORIES,
    ]);
  });
});
