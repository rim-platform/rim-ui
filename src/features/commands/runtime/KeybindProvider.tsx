import { useEffect, useRef, type ReactNode } from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { parseKeystroke, matchKeybind, surfaceToContext } from "./keybindEngine";
import { dispatchCommand } from "./commandDispatcher";
import { useCommandStore } from "../state/useCommandStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import type { ResolvedKeybind, CommandDefinition } from "../types";

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
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_settings",
    keystroke: "Ctrl+Alt+S",
    commandId: "workspace.open_settings",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_search",
    keystroke: "Ctrl+F",
    commandId: "workspace.search_in_channel",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_search_workspace",
    keystroke: "Ctrl+Shift+F",
    commandId: "workspace.open_search",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_marketplace",
    keystroke: "Ctrl+Shift+X",
    commandId: "workspace.open_marketplace",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_agent",
    keystroke: "Ctrl+Shift+A",
    commandId: "workspace.open_agent",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_create_channel",
    keystroke: "Ctrl+Shift+C",
    commandId: "chat.create_channel",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_create_group",
    keystroke: "Ctrl+Shift+G",
    commandId: "chat.create_group",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_mark_all_read",
    keystroke: "Ctrl+Shift+M",
    commandId: "chat.mark_all_as_read",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_cycle_density",
    keystroke: "Ctrl+D",
    commandId: "workspace.cycle_display_density",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_navigate_channel",
    keystroke: "Ctrl+Shift+K",
    commandId: "workspace.navigate_to_channel",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_prev_channel",
    keystroke: "Alt+ArrowUp",
    commandId: "workspace.previous_channel",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_next_channel",
    keystroke: "Alt+ArrowDown",
    commandId: "workspace.next_channel",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_zen_mode",
    keystroke: "Ctrl+Shift+Z",
    commandId: "workspace.toggle_zen_mode",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_cycle_layout",
    keystroke: "Ctrl+L",
    commandId: "workspace.cycle_layout_preset",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_panel_left",
    keystroke: "Ctrl+ArrowLeft",
    commandId: "workspace.navigate_panel_left",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
  {
    id: "__fallback_panel_right",
    keystroke: "Ctrl+ArrowRight",
    commandId: "workspace.navigate_panel_right",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  },
];

/**
 * Merge backend keybinds with fallbacks. Fallback keybinds are included
 * unless the backend already provides a binding for the same commandId.
 * This ensures local-only commands (search overlay, marketplace, etc.)
 * always have their keybinds available.
 */
function mergeWithFallbacks(backendKeybinds: ResolvedKeybind[] | undefined): ResolvedKeybind[] {
  if (!backendKeybinds || backendKeybinds.length === 0) return FALLBACK_KEYBINDS;

  const backendCommandIds = new Set(backendKeybinds.map((kb) => kb.commandId));
  const missingFallbacks = FALLBACK_KEYBINDS.filter((fb) => !backendCommandIds.has(fb.commandId));
  return [...backendKeybinds, ...missingFallbacks];
}

export function KeybindProvider({ children }: KeybindProviderProps) {
  const { capabilities } = useRuntime();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const focusedSurface = useShellStore((s) => s.focusedSurface);

  const { data: keybinds } = useResolvedKeybinds(workspaceId ?? undefined);
  const { data: commands } = useCommands("PALETTE");
  const executeCommandMutation = useExecuteCommandMutation();
  const executeMutationRef = useRef(executeCommandMutation);
  executeMutationRef.current = executeCommandMutation;

  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const isTextInput =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

    const keystroke = parseKeystroke(event);
    if (!keystroke) return;

    const context = surfaceToContext(focusedSurface);

    // Merge backend keybinds with fallbacks — fallbacks fill in any
    // commands the backend doesn't know about (e.g. local-only search)
    const resolvedKeybinds = mergeWithFallbacks(keybinds);

    // Try context-specific match first, then global
    let match = matchKeybind(keystroke, context, resolvedKeybinds);
    if (!match && isTextInput) {
      // In text inputs, only match Global keybinds with Ctrl/Cmd or Alt modifier
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      match = matchKeybind(keystroke, "GLOBAL", resolvedKeybinds);
    }

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
        shell.showInviteDialog;
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
    const command: CommandDefinition = commands?.find((cmd) => cmd.id === match!.commandId) ?? {
      id: match.commandId,
      title: match.commandId,
      description: "",
      category: "",
      sourceKind: "BUILT_IN",
      executionTarget: isLocalPrefix ? "DESKTOP_LOCAL" : "BACKEND",
      requiredContext: [],
      requiredCapabilities: [],
      visibleInPalette: false,
      visibleInContextMenus: false,
      keybindCapable: true,
      dangerous: false,
    };

    dispatchCommand(command, (input) => executeMutationRef.current.mutateAsync(input), {
      args: match.presetArgs as Record<string, unknown> | undefined,
      commandContext: {
        workspaceId: workspaceId ?? undefined,
      },
    });
  };

  useEffect(() => {
    if (!capabilities.deviceLocalKeybinds) return;

    const stableHandler = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    window.addEventListener("keydown", stableHandler, true);
    return () => window.removeEventListener("keydown", stableHandler, true);
  }, [capabilities.deviceLocalKeybinds]);

  return <>{children}</>;
}
