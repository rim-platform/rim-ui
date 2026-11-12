import { useEffect, useRef, type ReactNode } from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { detectOs } from "../../../core/runtime/runtime";
import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";
import { hasPanelToClose } from "../../../shell/state/closeTopPanel";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { useCommandsWithMacros } from "../../macros/api/useMacroCommands";
import {
  isKeystrokeRecorder,
  parseKeystroke,
  matchKeybind,
  surfaceToContext,
} from "./keybindEngine";
import { dispatchCommand } from "./commandDispatcher";
import { showCommandOutcome } from "./commandOutcome";
import { showCommandRefusal } from "./refusal";
import { currentCommandContext } from "./commandContext";
import { useCommandStore } from "../state/useCommandStore";
import { useCommandResultStore } from "../state/useCommandResultStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { isTextEntry } from "../../../shared/ui/focusNavigation";
import { hostDialogOpen } from "../../../shared/ui/hostDialogs";
import { useEffectiveKeybinds } from "./effectiveKeybinds";
import { toast } from "../../../shared/toast";
import { keybindCommand, keybindCommandTitle } from "./keybindCommand";
import { installVimLayer } from "./vimLayer";
import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import { keybindAnswersWaitingAgent } from "./appCommands/agents";

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
  const { data: keybindCommands } = useCommandsWithMacros("KEYBIND_PICKER");
  const { data: paletteCommands } = useCommands("PALETTE");
  const executeCommandMutation = useExecuteCommandMutation();
  const executeMutationRef = useRef(executeCommandMutation);
  executeMutationRef.current = executeCommandMutation;

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    if (isKeystrokeRecorder(event.target)) return;
    // A host dialog owns the keyboard: no keybind runs, the palette's included, until it closes,
    // except one answering the agent request or connection the dialog asks about.
    const dialogOpen = hostDialogOpen();
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
    if (dialogOpen && !keybindAnswersWaitingAgent(match.commandId)) return;

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

    const command = keybindCommand(match.commandId, keybindCommands, paletteCommands);
    if (!command) {
      toast.error(`${keybindCommandTitle(match.commandId)}: This command isn't available here`);
      return;
    }

    // A search with its query given opens the search overlay on that query.
    const presetArgs = (match.presetArgs ?? undefined) as Record<string, unknown> | undefined;
    const presetQuery = presetArgs?.query;
    if (
      match.commandId === "chat.search_messages" &&
      typeof presetQuery === "string" &&
      presetQuery.trim() !== ""
    ) {
      useSearchOverlayStore.getState().openWithScope({ kind: "all" }, presetQuery);
      return;
    }

    // A retry runs where the key was pressed, wherever the person is by then.
    const commandContext = currentCommandContext();
    const run = (args: Record<string, unknown> | undefined) => {
      // The arguments it ran with, with any the argument form asked for.
      let ranWith = args;
      const execute = (input: Parameters<typeof executeMutationRef.current.mutateAsync>[0]) =>
        executeMutationRef.current.mutateAsync({ ...input, initiator: CommandInitiator.KEYBIND });
      // Saved arguments are used as given, as a macro step's are: a server command runs with
      // them even when this app has a dialog for it, which opens only when none are saved.
      dispatchCommand(command, execute, {
        args,
        commandContext,
        typedArgs: true,
        askForArguments: true,
        onArguments: (filled) => {
          ranWith = filled;
        },
      })
        .then((result) => showCommandOutcome(command, result, ranWith, commandContext))
        .catch((err: unknown) => {
          logger.warn(`[RIM:Keybind] ${match.commandId} failed`, err);
          showCommandRefusal(command.title, err, () => run(ranWith));
        });
    };
    run(presetArgs);
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
