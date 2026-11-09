import type { Mock } from "vitest";

import { CommandSensitivity } from "../core/graphql/generated/schema-types";
import { queryKeys } from "../core/query/keys";
import { queryClient } from "../core/query/queryClient";
import type { CommandDefinition, CommandResult } from "../features/commands/types";

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
