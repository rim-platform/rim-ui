import { useEffect, useRef, type ReactNode } from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { logger } from "../../../core/logger";
import {
  FEATURE_DISABLED,
  graphqlErrorCode,
  graphqlErrorMessage,
} from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { parseKeystroke, matchKeybind, surfaceToContext } from "./keybindEngine";
import { dispatchCommand } from "./commandDispatcher";
import { useCommandStore } from "../state/useCommandStore";
import {
  findPluginCommand,
  toastPluginCommandResult,
} from "../../plugins/runtime/pluginCommandInfo";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { isTextEntry } from "../../../shared/ui/focusNavigation";
import { useEffectiveKeybinds } from "./effectiveKeybinds";
import { LOCAL_COMMANDS } from "./localCommands";
import { installVimLayer } from "./vimLayer";
import type { CommandDefinition } from "../types";

interface KeybindProviderProps {
  children: ReactNode;
}

/**
 * Text-editing chords that keep their editing meaning inside a text field, even when a global
 * keybind uses them: word jumps, word deletes, select all, clipboard, undo and redo.
 */
const TEXT_EDITING_KEYSTROKES = new Set([
  "Ctrl+ArrowLeft",
  "Ctrl+ArrowRight",
  "Ctrl+Shift+ArrowLeft",
  "Ctrl+Shift+ArrowRight",
  "Ctrl+Backspace",
  "Ctrl+Delete",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+Y",
]);

/** Whether a dialog or menu of the host is open; Escape then belongs to it. */
function hostOverlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"]') !== null;
}

export function KeybindProvider({ children }: KeybindProviderProps) {
  const { capabilities } = useRuntime();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const focusedSurface = useShellStore((s) => s.focusedSurface);

  const resolvedKeybinds = useEffectiveKeybinds();
  const { data: commands } = useCommands("PALETTE");
  const executeCommandMutation = useExecuteCommandMutation();
  const executeMutationRef = useRef(executeCommandMutation);
  executeMutationRef.current = executeCommandMutation;

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    const isTextInput = isTextEntry(event.target as Element);

    const keystroke = parseKeystroke(event);
    if (!keystroke) return;

    const context = surfaceToContext(focusedSurface);

    // In a text field, a key that types a character and the text-editing chords stay with the
    // field: only a binding made for that very context can take one. Other keys match the
    // context's bindings and the global ones.
    const typesCharacter =
      event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    const keepInField = isTextInput && (typesCharacter || TEXT_EDITING_KEYSTROKES.has(keystroke));
    const match = keepInField
      ? context === "GLOBAL"
        ? null
        : matchKeybind(
            keystroke,
            context,
            resolvedKeybinds.filter((kb) => kb.context === context),
          )
      : matchKeybind(keystroke, context, resolvedKeybinds);

    if (!match) return;

    // If an overlay/dialog is open, let it handle Escape instead of dispatching close_panel
    if (match.commandId === "workspace.close_panel") {
      const shell = useShellStore.getState();
      const overlayOpen =
        useCommandStore.getState().isCommandPaletteOpen ||
        useSearchOverlayStore.getState().isOpen ||
        useAgentStore.getState().isOpen ||
        shell.showNewChannelDialog ||
        shell.showNewMessagePicker ||
        shell.showInviteDialog ||
        hostOverlayOpen();
      if (overlayOpen) {
        return;
      }
      // Check whether there is actually a panel to close (thread open or
      // non-conversation surface like settings/plugin).  When nothing
      // needs closing, let the event fall through completely so the
      // ComposerInput's own Escape handler (or message list handler) can
      // process it naturally.
      const hasPanelToClose = shell.isThreadOpen || shell.mainSurface.kind !== "conversation";
      if (!hasPanelToClose) {
        return;
      }
    }

    logger.debug(`[RIM:Keybind] Matched: ${keystroke} → ${match.commandId}`);

    event.preventDefault();
    event.stopPropagation();

    // Find command definition from backend. If commands haven't loaded yet,
    // build a minimal dispatch stub so keybinds still work during loading.
    // The stub is only used for dispatch — never shown in UI.
    const isLocalPrefix =
      match.commandId.startsWith("workspace.") ||
      match.commandId.startsWith("chat.") ||
      match.commandId.startsWith("admin.");
    const isPluginCommand = match.commandId.startsWith("plugin.");
    const pluginCommand = isPluginCommand ? findPluginCommand(match.commandId) : null;
    const command: CommandDefinition = commands?.find((cmd) => cmd.id === match.commandId) ??
      LOCAL_COMMANDS.find((cmd) => cmd.id === match.commandId) ?? {
        id: match.commandId,
        title: pluginCommand?.title ?? match.commandId,
        description: "",
        category: "",
        sourceKind: isPluginCommand ? "PLUGIN" : "BUILT_IN",
        executionTarget: isLocalPrefix || isPluginCommand ? "DESKTOP_LOCAL" : "BACKEND",
        requiredContext: [],
        requiredCapabilities: [],
        visibleInPalette: false,
        visibleInContextMenus: false,
        keybindCapable: true,
        dangerous: pluginCommand?.dangerous ?? false,
      };

    dispatchCommand(command, (input) => executeMutationRef.current.mutateAsync(input), {
      args: match.presetArgs as Record<string, unknown> | undefined,
      commandContext: {
        workspaceId: workspaceId ?? undefined,
      },
    })
      .then((result) => {
        // A plugin command runs on this device, out of sight: say how it went.
        if (isPluginCommand) {
          toastPluginCommandResult(command.title, result);
        }
      })
      .catch((err: unknown) => {
        // A keybind for a command whose workspace feature is off (Track 0.4) says why instead
        // of doing nothing; other keybind failures stay in the log as before.
        if (graphqlErrorCode(err) === FEATURE_DISABLED) {
          toast.error(graphqlErrorMessage(err, "This command is turned off for this workspace."));
          return;
        }
        logger.warn(`[RIM:Keybind] ${match.commandId} failed`, err);
      });
  };

  // The Vim layer listens first, so a key it takes never reaches the keybinds.
  useEffect(() => {
    if (!capabilities.deviceLocalKeybinds) return;
    return installVimLayer();
  }, [capabilities.deviceLocalKeybinds]);

  useEffect(() => {
    if (!capabilities.deviceLocalKeybinds) return;

    const stableHandler = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    window.addEventListener("keydown", stableHandler, true);
    return () => window.removeEventListener("keydown", stableHandler, true);
  }, [capabilities.deviceLocalKeybinds]);

  return <>{children}</>;
}
