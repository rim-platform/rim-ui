import { EDIT_HOME_COMMAND_ID, homeEditable } from "../../home/editHome";
import { workspaceCommandOffered } from "../../workspaces/workspaceActions";
import type { CommandDefinition } from "../types";
import { LOCAL_COMMANDS } from "./localCommands";

/**
 * This app's own commands that the palette and the message box offer in the open workspace:
 * those the server does not list itself (`serverIds`), that the workspace offers to the person,
 * and Edit Home only where Home can be edited.
 */
export function offeredLocalCommands(serverIds: ReadonlySet<string>): CommandDefinition[] {
  return LOCAL_COMMANDS.filter(
    (cmd) =>
      !serverIds.has(cmd.id) &&
      workspaceCommandOffered(cmd.id) &&
      (cmd.id !== EDIT_HOME_COMMAND_ID || homeEditable()),
  );
}
