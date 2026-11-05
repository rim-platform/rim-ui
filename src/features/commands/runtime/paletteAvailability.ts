import { QUIT_COMMAND_ID } from "../../desktop-shell/availability";

/** Commands the server refuses in the direct space, so the palette does not offer them there. */
export const DIRECT_SPACE_HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  "chat.list_channels",
  "state.list",
  "chat.join_channel",
  "workspace.navigate_to_channel",
]);

/** What decides whether the palette offers a command that only applies in some situations. */
export interface PaletteSituation {
  inDirectSpace: boolean;
  panelOpen: boolean;
  hasDirectOrigin: boolean;
  desktopApp: boolean;
}

/**
 * Whether the palette offers `commandId` in `situation`. Keybinds run the handlers regardless;
 * this only keeps the list free of commands that cannot apply.
 */
export function offeredInSituation(commandId: string, situation: PaletteSituation): boolean {
  if (situation.inDirectSpace && DIRECT_SPACE_HIDDEN_COMMANDS.has(commandId)) return false;
  if (commandId === "workspace.close_panel") return situation.panelOpen;
  if (commandId === "workspace.back_to_workspace") return situation.hasDirectOrigin;
  if (commandId === QUIT_COMMAND_ID) return situation.desktopApp;
  return true;
}
