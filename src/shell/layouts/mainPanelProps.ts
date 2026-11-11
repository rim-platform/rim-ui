import { useShellStore } from "../state/useShellStore";

/**
 * Marks a main surface other than the conversation as the grid's main panel, so pane
 * navigation and the Vim layer can move focus into it.
 */
export const MAIN_PANEL_PROPS = {
  "data-panel": "mainSurface",
  tabIndex: -1,
  onFocus: () => useShellStore.getState().setFocusedSurface("mainSurface"),
} as const;
