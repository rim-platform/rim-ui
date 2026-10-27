import type { CommandDefinition } from "../types";

function localCommand(id: string, title: string, description: string): CommandDefinition {
  return {
    id,
    title,
    description,
    category: "Workspace",
    sourceKind: "BUILT_IN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };
}

/**
 * Commands that exist only in this app. The server does not list them, so the palette and the
 * keybind picker add them here, and a keybind to one is kept on this device.
 */
export const LOCAL_COMMANDS: readonly CommandDefinition[] = [
  localCommand(
    "workspace.show_shortcuts",
    "Show Keyboard Shortcuts",
    "List every shortcut that works right now",
  ),
  localCommand(
    "workspace.toggle_vim_mode",
    "Toggle Vim Mode",
    "Turn the modal normal and insert layer on or off",
  ),
  localCommand(
    "workspace.previous_unread_channel",
    "Previous Unread Conversation",
    "Go to the previous conversation with unread messages",
  ),
  localCommand(
    "workspace.navigate_panel_left",
    "Focus the Pane to the Left",
    "Move keyboard focus to the pane on the left",
  ),
  localCommand(
    "workspace.navigate_panel_right",
    "Focus the Pane to the Right",
    "Move keyboard focus to the pane on the right",
  ),
  localCommand(
    "workspace.cycle_layout_preset",
    "Cycle Layout Preset",
    "Switch to the next saved layout",
  ),
  localCommand("workspace.toggle_zen_mode", "Toggle Zen Mode", "Hide everything but the timeline"),
  localCommand(
    "workspace.cycle_display_density",
    "Cycle Display Density",
    "Switch between comfortable, compact and ultra compact",
  ),
];

const LOCAL_COMMAND_IDS = new Set(LOCAL_COMMANDS.map((command) => command.id));

/** Whether `commandId` is one of this app's own commands. */
export function isLocalCommand(commandId: string): boolean {
  return LOCAL_COMMAND_IDS.has(commandId);
}

/**
 * Titles of server commands this app runs as its own action, for the surfaces that run them
 * here.
 */
export const CLIENT_COMMAND_LABELS: Readonly<
  Record<string, { title: string; description: string }>
> = {
  "chat.create_group": {
    title: "New Message",
    description: "Start a direct message or a group conversation.",
  },
};

/** `cmd` with the title and description this app shows for it, when it has its own. */
export function withClientLabel<T extends { id: string; title: string; description: string }>(
  cmd: T,
): T {
  const label = CLIENT_COMMAND_LABELS[cmd.id];
  return label ? { ...cmd, ...label } : cmd;
}

/**
 * Titles of the built-in commands a keybind can name without the server's command list, for
 * showing a binding when the list has not loaded or the server is out of reach.
 */
export const BUILT_IN_COMMAND_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LOCAL_COMMANDS.map((command) => [command.id, command.title])),
  "workspace.open_command_palette": "Open command palette",
  "workspace.open_settings": "Open settings",
  "workspace.search_in_channel": "Search in this conversation",
  "workspace.open_search": "Search the workspace",
  "workspace.open_marketplace": "Open the plugin marketplace",
  "workspace.open_agent": "Open the AI agent",
  "workspace.cycle_recent_activity": "Cycle recent activity",
  "workspace.toggle_sidebar": "Toggle the sidebar",
  "workspace.reopen_last_thread": "Reopen the last thread",
  "workspace.focus_composer": "Focus the composer",
  "workspace.focus_message_list": "Focus the message list",
  "workspace.navigate_to_channel": "Jump to a conversation",
  "workspace.previous_channel": "Previous conversation",
  "workspace.next_channel": "Next conversation",
  "workspace.next_unread_channel": "Next unread conversation",
  "workspace.close_panel": "Close the open panel",
  "chat.create_channel": "Create a channel",
  "chat.create_group": CLIENT_COMMAND_LABELS["chat.create_group"].title,
  "chat.mark_all_as_read": "Mark everything as read",
};
