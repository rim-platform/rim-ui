import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
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
    }
  }
`;

export function useCommands(surface?: CommandSurface, commandContext?: CommandContextInput) {
  return useQuery({
    queryKey: queryKeys.commands(surface),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ commands: CommandDefinition[] }>(
        CommandsDocument,
        { surface: surface ?? "Palette", commandContext }
      );
      return res.commands;
    },
  });
}

export function useExecuteCommandMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      commandId: string;
      args?: Record<string, unknown>;
      commandContext?: CommandContextInput;
      confirmedDangerous?: boolean;
    }) =>
      graphqlClient.request<{ executeCommand: CommandResult }>(
        ExecuteCommandDocument,
        {
          input: {
            commandId: input.commandId,
            args: input.args,
            commandContext: input.commandContext,
            confirmedDangerous: input.confirmedDangerous,
          },
        }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}
