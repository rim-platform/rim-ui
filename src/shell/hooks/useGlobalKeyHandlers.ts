import { useEffect } from "react";
import { useShellStore } from "../state/useShellStore";
import { useTerminalStore } from "../../features/terminal/state/useTerminalStore";
import { toast } from "../../shared/toast";

/**
 * Global keyboard handlers:
 * 1. Ctrl+` toggles terminal open/close.
 * 2. ESC exits zen mode when active (skipped when terminal is focused — blurs terminal instead).
 * 3. Printable characters auto-focus the composer (skipped when terminal is focused).
 */
export function useGlobalKeyHandlers() {
  // Ctrl+` toggles terminal
  useEffect(() => {
    function handleTerminalToggle(e: KeyboardEvent) {
      // Match by physical key (Backquote) for layout independence, or by character (`)
      if (e.key !== "`" && e.code !== "Backquote") return;
      // Ctrl+` on Windows/Linux, Cmd+` on macOS
      const modifierHeld = e.ctrlKey || e.metaKey;
      if (!modifierHeld) return;
      e.preventDefault();
      e.stopPropagation();
      const { enabled } = useTerminalStore.getState();
      if (!enabled) return;
      useTerminalStore.getState().toggleOpen();
    }
    document.addEventListener("keydown", handleTerminalToggle, true);
    return () => document.removeEventListener("keydown", handleTerminalToggle, true);
  }, []);

  // ESC exits zen mode when active.
  // Does NOT stopPropagation — let ESC also reach the message navigation
  // handler (React bubble phase) so both zen mode and navigation mode
  // are exited simultaneously.
  // When terminal is focused, Escape blurs terminal instead of exiting zen mode.
  useEffect(() => {
    function handleZenEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;

      // When terminal is focused, blur it and return focus to previous surface
      if (useShellStore.getState().focusedSurface === "terminal") {
        useShellStore.getState().setFocusedSurface(null);
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
        if (composer) {
          composer.focus();
        } else {
          (document.activeElement as HTMLElement)?.blur?.();
        }
        return;
      }

      if (!useShellStore.getState().zenMode) return;
      useShellStore.getState().toggleZenMode();
      toast.info("Zen Mode off", { duration: 1500 });
    }
    document.addEventListener("keydown", handleZenEscape, true);
    return () => document.removeEventListener("keydown", handleZenEscape, true);
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Skip if modifier keys (except Shift) are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Skip when terminal is focused — let xterm.js handle all input
      if (useShellStore.getState().focusedSurface === "terminal") return;

      // Skip if in navigation mode — let message list handle single keys
      if (useShellStore.getState().navigationMode) return;
      // Skip non-printable keys
      if (e.key.length !== 1) return;
      // Skip if already focused on an input/textarea/contenteditable
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return;

      const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
      if (composer) {
        composer.focus();
        // Don't preventDefault — let the character land in the textarea naturally
      }
    }

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);
}
