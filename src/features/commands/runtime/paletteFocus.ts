import { useShellStore } from "../../../shell/state/useShellStore";

/**
 * Clears the palette's claim on the focus when it closes. A command run from the palette may
 * have moved the focus to a surface already; that focus stays.
 */
export function releasePaletteFocus(): void {
  const shell = useShellStore.getState();
  if (shell.focusedSurface === "commandPalette") shell.setFocusedSurface(null);
}
