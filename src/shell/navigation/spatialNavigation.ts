import { useEffect } from "react";

import { useShellStore } from "../state/useShellStore";
import { getVisiblePanels, getAdjacentPanel } from "./panelGrid";
import type { PanelId, Direction } from "./panelGrid";

/**
 * Map focusedSurface strings to panel IDs.
 * The shell uses various surface names; we map them to our panel grid.
 */
function surfaceToPanelId(surface: string | null): PanelId | null {
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

export function navigatePanel(direction: Direction): void {
  const shell = useShellStore.getState();
  const visiblePanels = getVisiblePanels(shell);
  const currentPanel = surfaceToPanelId(shell.focusedSurface);

  const target = getAdjacentPanel(currentPanel ?? "mainSurface", direction, visiblePanels);

  if (!target) return;

  shell.setFocusedSurface(target);

  // Focus the DOM element for the target panel
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-panel="${target}"]`);
    el?.focus();
  });
}

/**
 * Hook that enables Ctrl+ArrowLeft/Right spatial navigation between panels.
 * Should be mounted once in WorkspaceShell.
 */
export function useSpatialNavigation(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only respond to Ctrl+Arrow keys
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      // Don't interfere with text inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // Ctrl+Arrow navigates panels — this is orthogonal to j/k message
      // navigation, so it should work regardless of navigation mode.

      const direction: Direction = e.key === "ArrowLeft" ? "left" : "right";
      navigatePanel(direction);
    }

    // Use capture phase so we can intercept before other handlers
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}
