import type { CommandContextInput } from "../../../core/graphql/generated/schema-types";
import { currentCommandContext } from "../../commands/runtime/commandContext";

/**
 * The agent's current context as `executeCommand` takes it in `commandContext`: the same context
 * the palette and keybinds send, with the workspace, the open conversation, the thread open
 * beside it and the focused surface.
 *
 * @returns The context, or `null` when no workspace is selected.
 */
export function getCurrentCommandContext(): CommandContextInput | null {
  const ctx = currentCommandContext();
  return ctx.workspaceId ? ctx : null;
}
