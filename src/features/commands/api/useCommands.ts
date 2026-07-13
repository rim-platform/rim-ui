import { useQuery, useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import type {
  CommandSurface,
  CommandContextInput,
  CommandDefinition,
  CommandResult,
} from "../types";

const CommandsDocument = gql`
  query Commands($surface: CommandSurface, $commandContext: CommandContextInput) {
    commands(surface: $surface, commandContext: $commandContext) {
      id
      title
      description
      category
      sourceKind
      executionTarget
      requiredContext
      requiredCapabilities
      visibleInPalette
      visibleInContextMenus
      keybindCapable
      dangerous
    }
  }
`;

const ExecuteCommandDocument = gql`
  mutation ExecuteCommand($input: ExecuteCommandInput!) {
    executeCommand(input: $input) {
      status
      message
      payload
      followUpCommands
      pipelineStages {
        stageIndex
        commandId
        status
        message
        payload
      }
    }
  }
`;

export function useCommands(surface?: CommandSurface, commandContext?: CommandContextInput) {
  return useQuery({
    queryKey: queryKeys.commands(surface),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ commands: CommandDefinition[] }>(CommandsDocument, {
        surface: surface ?? "PALETTE",
        commandContext,
      });
      return res.commands;
    },
  });
}

export function useExecuteCommandMutation() {
  return useMutation({
    mutationFn: (input: {
      commandId: string;
      args?: Record<string, unknown>;
      commandContext?: CommandContextInput;
      confirmedDangerous?: boolean;
      isPipe?: boolean;
    }) =>
      graphqlClient.request<{ executeCommand: CommandResult }>(ExecuteCommandDocument, {
        input: {
          commandId: input.commandId,
          args: input.args,
          commandContext: input.commandContext,
          confirmedDangerous: input.confirmedDangerous,
          isPipe: input.isPipe,
        },
      }),
  });
}

/**
 * Invalidate the commands cache, forcing a fresh fetch on next access.
 * Call this after events that change the command registry:
 * - User command create/update/delete
 * - Plugin install/uninstall/enable/disable
 * - Explicit "Reload commands" action
 */
export function reloadCommands() {
  queryClient.invalidateQueries({ queryKey: ["commands"] });
}
