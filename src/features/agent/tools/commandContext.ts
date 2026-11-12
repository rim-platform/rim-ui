import type { CommandContextInput } from "../../../core/graphql/generated/schema-types";
import { currentCommandContext } from "../../commands/runtime/commandContext";

/**
 * The agent's current context as `executeCommand` takes it in `commandContext`: the context the
 * palette and keybinds send, with the workspace, the open conversation, the thread open beside it
 * and the focused surface, but never the message selected in the list, which is the person's to
 * act on.
 *
 * @returns The context, or `null` when no workspace is selected.
 */
export function getCurrentCommandContext(): CommandContextInput | null {
  const ctx = currentCommandContext();
  delete ctx.selectedMessageId;
  return ctx.workspaceId ? ctx : null;
}
