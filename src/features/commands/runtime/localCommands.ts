import { QUIT_COMMAND_ID } from "../../desktop-shell/availability";
import type { CommandDefinition } from "../types";

function localCommand(
  id: string,
  title: string,
  description: string,
  keybindCapable = true,
): CommandDefinition {
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
    keybindCapable,
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
    "workspace.back_to_workspace",
    "Back to Workspace",
    "Return to the workspace and conversation a direct message was opened from",
  ),
  localCommand(
    "workspace.cycle_display_density",
    "Cycle Display Density",
    "Switch between comfortable, compact and ultra compact",
  ),
  localCommand("workspace.rename", "Rename Workspace…", "Give the open workspace a new name"),
  localCommand("workspace.open_bots", "Open Bots", "Open the workspace's bots in Settings"),
  localCommand("workspace.leave", "Leave Workspace…", "Leave the open workspace"),
  localCommand(
    "workspace.open_agents",
    "Open Agents",
    "Connect programs, choose what they can read and see their runs",
  ),
  localCommand(
    "workspace.open_unreads",
    "Open Unreads",
    "See everything you haven't read across your workspaces",
  ),
  localCommand(
    "workspace.unreads_next",
    "Unreads: Next Message",
    "Select the next message on the Unreads page",
  ),
  localCommand(
    "workspace.unreads_previous",
    "Unreads: Previous Message",
    "Select the previous message on the Unreads page",
  ),
  localCommand(
    "workspace.unreads_mark_group",
    "Unreads: Mark Conversation as Read",
    "Mark the selected conversation read up to the newest message shown",
  ),
  localCommand(
    "workspace.unreads_open",
    "Unreads: Open Message",
    "Open the selected message in its conversation",
  ),
  localCommand(
    "workspace.unreads_undo",
    "Unreads: Undo",
    "Take back the last mark while it is still waiting",
  ),
  localCommand("workspace.open_home", "Open Home", "See what needs you across your workspaces"),
  // Changing Home is the person's own act from the palette or Home, never a keybind's.
  localCommand(
    "workspace.edit_home",
    "Edit Home",
    "Move, resize, add and remove the boxes on Home",
    false,
  ),
  localCommand(
    "workspace.open_audit_log",
    "Open Audit Log",
    "Open the workspace's record of who did what",
  ),
  localCommand(
    "workspace.open_message_requests",
    "Open Message Requests",
    "Open the direct message requests waiting for an answer",
  ),
  localCommand(
    "workspace.toggle_pinned_messages",
    "Toggle Pinned Messages",
    "Show or hide the open conversation's pinned messages",
  ),
  localCommand(
    "workspace.toggle_channel_bots",
    "Toggle Bots in This Channel",
    "Show or hide the bots in the open channel and what their adders say",
  ),
  localCommand(
    "workspace.toggle_notifications",
    "Toggle Notifications",
    "Show or hide the notification inbox",
  ),
  localCommand(
    "workspace.toggle_conversation_members",
    "Toggle Conversation Members",
    "Show or hide the open conversation's members",
  ),
  localCommand(
    "workspace.toggle_member_directory",
    "Toggle Workspace Members",
    "Show or hide the workspace's member directory",
  ),
  localCommand(
    "workspace.toggle_lens_picker",
    "Toggle Channel Lenses",
    "Show or hide the open channel's lenses",
  ),
  localCommand("workspace.go_back", "Go Back", "Open the place you were before this one"),
  localCommand("workspace.go_forward", "Go Forward", "Open the place you went back from"),
  localCommand(QUIT_COMMAND_ID, "Quit RIM", "Stop RIM completely, including in the tray"),
];

const LOCAL_COMMAND_IDS = new Set(LOCAL_COMMANDS.map((command) => command.id));

/**
 * The id prefixes of commands this app runs itself. A keybind to an id under one of them runs
 * here, not on the server, while the command lists have not loaded.
 */
export const LOCAL_COMMAND_NAMESPACES: readonly string[] = [
  "workspace.",
  "chat.",
  "admin.",
  "plugin.",
];

/** Whether `commandId` is under one of {@link LOCAL_COMMAND_NAMESPACES}. */
export function inLocalCommandNamespace(commandId: string): boolean {
  return LOCAL_COMMAND_NAMESPACES.some((prefix) => commandId.startsWith(prefix));
}

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
  "workspace.previous_channel": {
    title: "Previous Conversation",
    description: "Go to the conversation above in the sidebar.",
  },
  "workspace.next_channel": {
    title: "Next Conversation",
    description: "Go to the conversation below in the sidebar.",
  },
  "workspace.open_marketplace": {
    title: "Open Marketplace",
    description: "Coming soon: browse and install plugins",
  },
  "workspace.next_unread_channel": {
    title: "Next Unread Conversation",
    description: "Go to the next conversation with unread messages.",
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
 * The server's titles of the built-in commands a keybind can name, as its registry declares
 * them.
 */
const SERVER_COMMAND_TITLES: Readonly<Record<string, string>> = {
  "workspace.open_command_palette": "Open Command Palette",
  "workspace.open_settings": "Open Settings",
  "workspace.search_in_channel": "Search in Channel",
  "workspace.open_search": "Open Search",
  "workspace.open_marketplace": "Open Marketplace",
  "workspace.open_agent": "Open AI Agent",
  "workspace.cycle_recent_activity": "Cycle Recent Activity",
  "workspace.toggle_sidebar": "Toggle Sidebar",
  "workspace.reopen_last_thread": "Reopen Last Thread",
  "workspace.focus_composer": "Focus Composer",
  "workspace.focus_message_list": "Focus Message List",
  "workspace.navigate_to_channel": "Navigate to Channel",
  "workspace.previous_channel": "Previous Channel",
  "workspace.next_channel": "Next Channel",
  "workspace.next_unread_channel": "Next Unread Channel",
  "workspace.close_panel": "Close Panel",
  "chat.create_channel": "Create Channel",
  "chat.create_group": "Create Group",
  "chat.mark_all_as_read": "Mark All as Read",
};

/**
 * Titles of the built-in commands a keybind can name without the server's command list, for
 * showing a binding when the list has not loaded or the server is out of reach. Each is the
 * title the loaded list shows for it: this app's own, else the server's.
 */
export const BUILT_IN_COMMAND_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LOCAL_COMMANDS.map((command) => [command.id, command.title])),
  ...Object.fromEntries(
    Object.entries(SERVER_COMMAND_TITLES).map(([id, title]) => [
      id,
      withClientLabel({ id, title, description: "" }).title,
    ]),
  ),
};
