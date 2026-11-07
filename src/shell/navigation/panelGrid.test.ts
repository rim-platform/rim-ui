import { describe, it, expect } from "vitest";

import { getAdjacentPanel, getVisiblePanels } from "./panelGrid";

const base = {
  zenMode: false,
  sidebarCollapsed: false,
  isThreadOpen: false,
  selectedRootMessageId: null,
  mainSurface: { kind: "conversation" },
};

describe("getVisiblePanels", () => {
  it("orders the rail, the top bar, the list, the conversation and the thread", () => {
    expect(getVisiblePanels({ ...base, isThreadOpen: true, selectedRootMessageId: "m1" })).toEqual([
      "workspaceRail",
      "topBar",
      "toolPanel",
      "mainSurface",
      "threadPane",
    ]);
  });

  it("leaves the list out while the sidebar is collapsed, and keeps the top bar", () => {
    expect(getVisiblePanels({ ...base, sidebarCollapsed: true })).toEqual([
      "workspaceRail",
      "topBar",
      "mainSurface",
    ]);
  });

  it("keeps the top bar on a page in place of the conversation", () => {
    expect(getVisiblePanels({ ...base, mainSurface: { kind: "settings" } })).toEqual([
      "workspaceRail",
      "topBar",
      "mainSurface",
    ]);
  });

  it("keeps only the main surface in zen mode", () => {
    expect(getVisiblePanels({ ...base, zenMode: true })).toEqual(["mainSurface"]);
  });
});

describe("getAdjacentPanel", () => {
  const panels = getVisiblePanels(base);

  it("moves from the rail to the top bar and on to the list", () => {
    expect(getAdjacentPanel("workspaceRail", "right", panels)).toBe("topBar");
    expect(getAdjacentPanel("topBar", "right", panels)).toBe("toolPanel");
    expect(getAdjacentPanel("toolPanel", "left", panels)).toBe("topBar");
    expect(getAdjacentPanel("topBar", "left", panels)).toBe("workspaceRail");
  });
});
