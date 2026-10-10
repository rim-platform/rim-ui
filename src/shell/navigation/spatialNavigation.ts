import { useShellStore } from "../state/useShellStore";
import { getVisiblePanels, getAdjacentPanel } from "./panelGrid";
import type { PanelId, Direction } from "./panelGrid";

/**
 * The panel of the grid a focused surface belongs to, or `null` for a surface outside it.
 * The shell names surfaces in several ways; this maps them onto the panel grid.
 */
export function panelIdForSurface(surface: string | null): PanelId | null {
  switch (surface) {
    case "workspaceRail":
      return "workspaceRail";
    case "sideRail":
      return "sideRail";
    case "toolPanel":
      return "toolPanel";
    case "mainSurface":
    case "composer":
    case "message_list":
    case "messageList":
      return "mainSurface";
    case "threadPane":
    case "thread":
      return "threadPane";
    default:
      return null;
  }
}

/**
 * Move focus to the visible panel left or right of the focused one. The panel keybind
 * commands and the Vim layer's `h` and `l` run this.
 */
export function navigatePanel(direction: Direction): void {
  const shell = useShellStore.getState();
  const visiblePanels = getVisiblePanels(shell);
  const currentPanel = panelIdForSurface(shell.focusedSurface);

  const target = getAdjacentPanel(currentPanel ?? "mainSurface", direction, visiblePanels);

  if (!target) return;

  shell.setFocusedSurface(target);

  // Focus the DOM element for the target panel
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-panel="${target}"]`);
    el?.focus();
  });
}
