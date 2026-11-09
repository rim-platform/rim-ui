/** Commands the server refuses in the direct space, so the palette does not offer them there. */
export const DIRECT_SPACE_HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  "chat.list_channels",
  "state.list",
  "chat.join_channel",
  "workspace.navigate_to_channel",
  "chat.browse_channels",
]);

/** What decides whether the palette offers a command that only applies in some situations. */
export interface PaletteSituation {
  inDirectSpace: boolean;
  panelOpen: boolean;
  hasDirectOrigin: boolean;
  /** Whether the Unreads page is the main surface. */
  unreadsOpen: boolean;
}

/** The commands that act on the Unreads page, so the palette offers them only there. */
export const UNREADS_PAGE_COMMANDS: ReadonlySet<string> = new Set([
  "workspace.unreads_next",
  "workspace.unreads_previous",
  "workspace.unreads_mark_group",
  "workspace.unreads_open",
  "workspace.unreads_undo",
  "unreads.mark_all_shown",
  "unreads.toggle_muted",
]);

/**
 * Whether the palette offers `commandId` in `situation`. Keybinds run the handlers regardless;
 * this only keeps the list free of commands that cannot apply.
 */
export function offeredInSituation(commandId: string, situation: PaletteSituation): boolean {
  if (situation.inDirectSpace && DIRECT_SPACE_HIDDEN_COMMANDS.has(commandId)) return false;
  if (UNREADS_PAGE_COMMANDS.has(commandId)) return situation.unreadsOpen;
  if (commandId === "workspace.close_panel") return situation.panelOpen;
  if (commandId === "workspace.back_to_workspace") return situation.hasDirectOrigin;
  return true;
}
