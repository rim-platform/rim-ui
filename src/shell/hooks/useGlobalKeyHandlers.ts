import { useEffect } from "react";
import { useShellStore } from "../state/useShellStore";
import { toast } from "../../shared/toast";
import { vimModeEnabled } from "../../features/commands/state/useKeybindProfileStore";
import { isKeystrokeRecorder } from "../../features/commands/runtime/keybindEngine";

/**
 * Global keyboard handlers:
 * 1. ESC exits zen mode when active.
 * 2. Printable characters auto-focus the composer, unless the Vim layer is on: there, keys
 *    outside a text field are normal-mode commands and `i` enters insert mode.
 */
export function useGlobalKeyHandlers() {
  // ESC exits zen mode when active.
  // Does NOT stopPropagation — let ESC also reach the message navigation
  // handler (React bubble phase) so both zen mode and navigation mode
  // are exited simultaneously.
  useEffect(() => {
    function handleZenEscape(e: KeyboardEvent) {
      if (isKeystrokeRecorder(e.target)) return;
      if (e.key !== "Escape") return;
      if (!useShellStore.getState().zenMode) return;
      useShellStore.getState().toggleZenMode();
      toast.info("Zen Mode off", { duration: 1500 });
    }
    document.addEventListener("keydown", handleZenEscape, true);
    return () => document.removeEventListener("keydown", handleZenEscape, true);
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (isKeystrokeRecorder(e.target)) return;
      // Skip if modifier keys (except Shift) are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Skip if in navigation mode — let message list handle single keys
      if (useShellStore.getState().navigationMode) return;
      if (vimModeEnabled()) return;
      // Skip non-printable keys
      if (e.key.length !== 1) return;
      // Skip if already focused on an input/textarea/contenteditable
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;

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
