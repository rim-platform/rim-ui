import { useEffect, useCallback, type ReactNode } from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { useCommandStore } from "../state/useCommandStore";
import { parseKeystroke, matchKeybind, surfaceToContext } from "./keybindEngine";
import { dispatchCommand } from "./commandDispatcher";
import type { ResolvedKeybind } from "../types";

interface KeybindProviderProps {
  children: ReactNode;
}

/**
 * Hardcoded keybinds that always work, even without a backend connection.
 * These match the backend's default keybinds but are available offline.
 */
const FALLBACK_KEYBINDS: ResolvedKeybind[] = [
  {
    id: "__fallback_palette",
    keystroke: "Ctrl+K",
    commandId: "workspace.open_command_palette",
    context: "Global",
    source: "Default",
    scope: "User",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_settings",
    keystroke: "Ctrl+,",
    commandId: "workspace.open_settings",
    context: "Global",
    source: "Default",
    scope: "User",
    isEnabled: true,
    presetArgs: null,
  },
];

export function KeybindProvider({ children }: KeybindProviderProps) {
  const { capabilities } = useRuntime();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const focusedSurface = useShellStore((s) => s.focusedSurface);
  const toggleCommandPalette = useCommandStore((s) => s.toggleCommandPalette);

  const { data: keybinds } = useResolvedKeybinds(workspaceId ?? undefined);
  const { data: commands } = useCommands("Palette");
  const executeCommandMutation = useExecuteCommandMutation();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTextInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const keystroke = parseKeystroke(event);
      if (!keystroke) return;

      const context = surfaceToContext(focusedSurface);

      // Use backend keybinds if available, otherwise use fallbacks
      const resolvedKeybinds = keybinds && keybinds.length > 0 ? keybinds : FALLBACK_KEYBINDS;

      // Try context-specific match first, then global
      let match = matchKeybind(keystroke, context, resolvedKeybinds);
      if (!match && isTextInput) {
        // In text inputs, only match Global keybinds with Ctrl/Cmd modifier
        if (!event.ctrlKey && !event.metaKey) return;
        match = matchKeybind(keystroke, "Global", resolvedKeybinds);
      }

      if (!match) return;

      event.preventDefault();
      event.stopPropagation();

      // Desktop-local commands can be handled directly without backend
      if (match.commandId === "workspace.open_command_palette") {
        toggleCommandPalette();
        return;
      }

      if (match.commandId === "workspace.open_settings") {
        useShellStore.getState().setMainSurface({ kind: "settings" });
        return;
      }

      // For other commands, find the definition and dispatch
      const command = commands?.find((cmd) => cmd.id === match!.commandId);
      if (!command) {
        logger.warn(`[RIM] Keybind matched but command not found: ${match.commandId}`);
        return;
      }

      dispatchCommand(command, (input) => executeCommandMutation.mutateAsync(input), {
        args: match.presetArgs as Record<string, unknown> | undefined,
        commandContext: {
          workspaceId: workspaceId ?? undefined,
        },
      });
    },
    [keybinds, commands, focusedSurface, workspaceId, executeCommandMutation, toggleCommandPalette]
  );

  useEffect(() => {
    if (!capabilities.deviceLocalKeybinds) return;

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown, capabilities.deviceLocalKeybinds]);

  return <>{children}</>;
}
