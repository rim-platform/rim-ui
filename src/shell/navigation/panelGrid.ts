export type PanelId = "workspaceRail" | "sideRail" | "toolPanel" | "mainSurface" | "threadPane";

export type Direction = "left" | "right";

interface ShellStateSlice {
  zenMode: boolean;
  sidebarCollapsed: boolean;
  isThreadOpen: boolean;
  selectedRootMessageId: string | null;
  mainSurface: { kind: string };
}

/**
 * Returns the ordered list of currently visible panels based on shell state.
 * Order is left-to-right as they appear in the layout.
 */
export function getVisiblePanels(shellState: ShellStateSlice): PanelId[] {
  const panels: PanelId[] = [];

  if (!shellState.zenMode) {
    panels.push("workspaceRail");
    if (!shellState.sidebarCollapsed) {
      panels.push("sideRail");
    }
  }

  if (shellState.mainSurface.kind === "conversation" && !shellState.zenMode) {
    panels.push("toolPanel");
  }

  panels.push("mainSurface");

  if (
    !shellState.zenMode &&
    shellState.isThreadOpen &&
    shellState.selectedRootMessageId &&
    shellState.mainSurface.kind === "conversation"
  ) {
    panels.push("threadPane");
  }

  return panels;
}

/**
 * Given a current panel and a direction, returns the adjacent panel
 * in the visible panel list, or null if at the edge.
 */
export function getAdjacentPanel(
  currentPanel: PanelId,
  direction: Direction,
  visiblePanels: PanelId[],
): PanelId | null {
  const idx = visiblePanels.indexOf(currentPanel);
  if (idx === -1) {
    // Current panel not visible — return first or last based on direction
    return direction === "right"
      ? (visiblePanels[0] ?? null)
      : (visiblePanels[visiblePanels.length - 1] ?? null);
  }

  const nextIdx = direction === "right" ? idx + 1 : idx - 1;
  return visiblePanels[nextIdx] ?? null;
}
