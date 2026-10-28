import { useEffect, useRef, type ReactNode } from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { detectOs } from "../../../core/runtime/runtime";
import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";
import { hasPanelToClose } from "../../../shell/state/closeTopPanel";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import {
  isKeystrokeRecorder,
  parseKeystroke,
  matchKeybind,
  surfaceToContext,
} from "./keybindEngine";
import { dispatchCommand, hasLocalHandler, isLocalActionResult } from "./commandDispatcher";
import { commandSuccessText } from "./commandResultText";
import { currentCommandContext } from "./commandContext";
import { useCommandStore } from "../state/useCommandStore";
import {
  findPluginCommand,
  toastPluginCommandResult,
} from "../../plugins/runtime/pluginCommandInfo";
import { isOpenPluginPanelCommand } from "../../plugins/pluginPanels";
import { toast } from "../../../shared/toast";
import { useCommandResultStore } from "../state/useCommandResultStore";
import { presentReadResult } from "./readCommandResult";
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

/** Option+Arrow word jumps on macOS, kept by a text field there. */
const MAC_TEXT_EDITING_KEYSTROKES = new Set([
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
  "Shift+Alt+ArrowLeft",
  "Shift+Alt+ArrowRight",
]);

/** Whether a dialog or menu of the host is open; Escape then belongs to it. */
function hostOverlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"]') !== null;
}

export function KeybindProvider({ children }: KeybindProviderProps) {
  const { capabilities } = useRuntime();
  const focusedSurface = useShellStore((s) => s.focusedSurface);

  const resolvedKeybinds = useEffectiveKeybinds();
  const { data: commands } = useCommands("PALETTE");
  const executeCommandMutation = useExecuteCommandMutation();
  const executeMutationRef = useRef(executeCommandMutation);
  executeMutationRef.current = executeCommandMutation;

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    if (isKeystrokeRecorder(event.target)) return;
    const isTextInput = isTextEntry(event.target as Element);

    const keystroke = parseKeystroke(event);
    if (!keystroke) return;

    const context = surfaceToContext(focusedSurface);

    // In a text field, a key that types a character and the text-editing chords stay with the
    // field: only a binding made for that very context can take one. Other keys match the
    // context's bindings and the global ones.
    const typesCharacter =
      event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    const keepInField =
      isTextInput &&
      (typesCharacter ||
        TEXT_EDITING_KEYSTROKES.has(keystroke) ||
        (MAC_TEXT_EDITING_KEYSTROKES.has(keystroke) && detectOs() === "macos"));
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
      // A composer's open suggestion list, or an inline prompt that answers Escape, takes it first.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-suggestions-open], [data-owns-escape]")
      )
        return;
      const shell = useShellStore.getState();
      const overlayOpen =
        useCommandStore.getState().isCommandPaletteOpen ||
        useSearchOverlayStore.getState().isOpen ||
        useCommandResultStore.getState().view !== null ||
        useAgentStore.getState().isOpen ||
        shell.showNewChannelDialog ||
        shell.showNewMessagePicker ||
        shell.showInviteDialog ||
        hostOverlayOpen();
      if (overlayOpen) {
        return;
      }
      // When nothing needs closing, let the event fall through completely so the
      // ComposerInput's own Escape handler (or message list handler) can
      // process it naturally.
      if (!hasPanelToClose()) {
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

    // A search with its query given opens the search overlay on that query.
    const presetArgs = match.presetArgs as Record<string, unknown> | undefined;
    const presetQuery = presetArgs?.query;
    if (
      match.commandId === "chat.search_messages" &&
      typeof presetQuery === "string" &&
      presetQuery.trim() !== ""
    ) {
      useSearchOverlayStore.getState().openWithScope({ kind: "all" }, presetQuery);
      return;
    }

    dispatchCommand(command, (input) => executeMutationRef.current.mutateAsync(input), {
      args: match.presetArgs as Record<string, unknown> | undefined,
      commandContext: currentCommandContext(),
    })
      .then((result) => {
        // A plugin command runs on this device, out of sight: say how it went.
        if (isPluginCommand) {
          toastPluginCommandResult(command.title, result);
        } else if (isOpenPluginPanelCommand(command.id) && result?.status === "ERROR") {
          // An open panel shows for itself; one that cannot open says why.
          toast.error(result.message);
        } else if (
          hasLocalHandler(command.id) &&
          result?.status === "SUCCESS" &&
          result.message.trim() &&
          !isLocalActionResult(result)
        ) {
          // A local command that has something to say says it, as the palette does.
          toast.success(commandSuccessText(command.title, result));
        } else if (!isPluginCommand) {
          void presentReadResult(
            command.id,
            command.title,
            result,
            presetArgs,
            currentCommandContext(),
          );
        }
      })
      .catch((err: unknown) => {
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
