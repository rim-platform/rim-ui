import type { Mock } from "vitest";

import { CommandSensitivity } from "../core/graphql/generated/schema-types";
import { queryKeys } from "../core/query/keys";
import { queryClient } from "../core/query/queryClient";
import type {
  CommandContextInput,
  CommandDefinition,
  CommandResult,
} from "../features/commands/types";
import { dispatchCommand } from "../features/commands/runtime/commandDispatcher";

/** A backend command as a server lists it, `MUTATING` and not dangerous unless overridden. */
export function backendCommand(
  id: string,
  overrides: Partial<CommandDefinition> = {},
): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: CommandSensitivity.MUTATING,
    ...overrides,
  };
}

/**
 * Puts the commands `ids` in the app's cached palette list of `workspaceId`, as its server lists
 * them, so a control's command is looked up there and sent without reading the list.
 */
export function serveCommands(workspaceId: string, ids: string[]): void {
  queryClient.setQueryData(
    queryKeys.commands("PALETTE", workspaceId),
    ids.map((id) => backendCommand(id)),
  );
}

/** Drops every command list the app cached, so the next test serves its own. */
export function clearServedCommands(): void {
  queryClient.removeQueries({ queryKey: ["commands"] });
}

/** The answer of an `ExecuteCommand` request that succeeded with `payload`. */
export function commandSucceeded(payload: unknown = null): { executeCommand: CommandResult } {
  return {
    executeCommand: { status: "SUCCESS", message: "", payload, followUpCommands: [] },
  };
}

/** What one `ExecuteCommand` request sent. */
export interface SentCommand {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
  initiator?: string;
}

/** The `input` of every `ExecuteCommand` request `requestMock` was called with, in order. */
export function sentCommands(requestMock: Mock): SentCommand[] {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("mutation ExecuteCommand"))
    .map(([, variables]) => (variables as { input: SentCommand }).input);
}

/** Caches `commands` as the palette list of `workspaceId`'s server, where a click looks them up. */
export function serveHostCommands(workspaceId: string, commands: CommandDefinition[]): void {
  queryClient.setQueryData(queryKeys.commands("PALETTE", workspaceId), commands);
}

/** A successful command result. */
export const COMMAND_OK: CommandResult = {
  status: "SUCCESS",
  message: "done",
  payload: null,
  followUpCommands: [],
};

/**
 * The `executeCommand` input the command palette sends when it runs `command` in
 * `commandContext`, with `args` typed for the server when given, as the dispatcher builds it.
 */
export async function paletteInput(
  command: CommandDefinition,
  commandContext: CommandContextInput,
  args?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let sent: Record<string, unknown> | undefined;
  await dispatchCommand(
    command,
    async (input) => {
      sent = input as Record<string, unknown>;
      return { executeCommand: COMMAND_OK };
    },
    {
      args,
      commandContext: { ...commandContext },
      askForArguments: true,
      // Arguments given with a command are typed for the server, as in the message box.
      typedArgs: args !== undefined && Object.keys(args).length > 0,
    },
  );
  if (!sent) throw new Error(`the palette sent nothing for ${command.id}`);
  return {
    commandId: sent.commandId,
    args: sent.args,
    commandContext: sent.commandContext,
    isPipe: sent.isPipe,
  };
}
