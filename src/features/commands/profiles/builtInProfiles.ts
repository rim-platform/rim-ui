import {
  PROFILE_FORMAT,
  PROFILE_VERSION,
  type KeybindProfile,
  type ProfileBinding,
} from "./keybindProfile";

function bind(keystroke: string, commandId: string | null): ProfileBinding {
  return { keystroke, commandId, context: "GLOBAL" };
}

/**
 * The plain default shortcut set. It mirrors the server's default keybinds, so the same keys
 * work offline, and adds this app's own commands. Every binding has a modifier except Escape
 * and `?`, which do nothing inside a text field.
 */
export const DEFAULT_BINDINGS: readonly ProfileBinding[] = [
  bind("Ctrl+K", "workspace.open_command_palette"),
  bind("Ctrl+Alt+S", "workspace.open_settings"),
  bind("Ctrl+F", "workspace.search_in_channel"),
  bind("Ctrl+Shift+F", "workspace.open_search"),
  bind("Ctrl+Shift+X", "workspace.open_marketplace"),
  bind("Ctrl+Shift+A", "workspace.open_agent"),
  bind("Ctrl+Shift+C", "chat.create_channel"),
  bind("Ctrl+Shift+G", "chat.create_group"),
  bind("Ctrl+Shift+M", "chat.mark_all_as_read"),
  bind("Ctrl+Shift+K", "workspace.navigate_to_channel"),
  bind("Ctrl+Shift+T", "workspace.reopen_last_thread"),
  bind("Ctrl+R", "workspace.cycle_recent_activity"),
  bind("Ctrl+B", "workspace.toggle_sidebar"),
  bind("Ctrl+E", "workspace.focus_composer"),
  bind("Ctrl+D", "workspace.cycle_display_density"),
  bind("Ctrl+L", "workspace.cycle_layout_preset"),
  bind("Ctrl+Shift+Z", "workspace.toggle_zen_mode"),
  bind("Alt+ArrowUp", "workspace.previous_channel"),
  bind("Alt+ArrowDown", "workspace.next_channel"),
  bind("Shift+Alt+ArrowUp", "workspace.previous_unread_channel"),
  bind("Shift+Alt+ArrowDown", "workspace.next_unread_channel"),
  bind("Ctrl+ArrowLeft", "workspace.navigate_panel_left"),
  bind("Ctrl+ArrowRight", "workspace.navigate_panel_right"),
  bind("Escape", "workspace.close_panel"),
  bind("?", "workspace.show_shortcuts"),
  bind("Ctrl+/", "workspace.show_shortcuts"),
];

/**
 * Keystrokes the mouse-friendly profile leaves to the browser and the text editor: reload,
 * bookmark, address bar, bold, redo and word jumps keep their usual meaning.
 */
const FAMILIAR_KEYSTROKES = new Set([
  "Ctrl+R",
  "Ctrl+B",
  "Ctrl+E",
  "Ctrl+D",
  "Ctrl+L",
  "Ctrl+Shift+Z",
  "Ctrl+ArrowLeft",
  "Ctrl+ArrowRight",
]);

function profile(
  name: string,
  description: string,
  vimMode: boolean,
  bindings: readonly ProfileBinding[],
): KeybindProfile {
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    name,
    description,
    vimMode,
    bindings: bindings.map((binding) => ({ ...binding })),
  };
}

export type BuiltInProfileId = "minimal" | "vim" | "mouse-friendly";

export const BUILT_IN_PROFILES: Readonly<Record<BuiltInProfileId, KeybindProfile>> = {
  minimal: profile(
    "Minimal",
    "The plain default shortcuts and no modes: every key either types or runs one command.",
    false,
    DEFAULT_BINDINGS,
  ),
  vim: profile(
    "Vim",
    "The default shortcuts plus a modal layer: normal mode moves with h j k l, insert mode types.",
    true,
    DEFAULT_BINDINGS,
  ),
  "mouse-friendly": profile(
    "Mouse-friendly",
    "Only shortcuts that take no familiar key: reload, bookmarks, bold, redo and word jumps work as they do elsewhere.",
    false,
    DEFAULT_BINDINGS.map((binding) =>
      FAMILIAR_KEYSTROKES.has(binding.keystroke) ? { ...binding, commandId: null } : binding,
    ),
  ),
};

export const BUILT_IN_PROFILE_IDS: readonly BuiltInProfileId[] = [
  "minimal",
  "vim",
  "mouse-friendly",
];

/** The profile a device starts with: today's shortcuts, Vim off. */
export const DEFAULT_PROFILE_ID: BuiltInProfileId = "minimal";
