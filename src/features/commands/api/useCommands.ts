import { useQuery, useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { noteTimedOutError } from "../../workspaces/state/useTimeoutStore";
import type {
  CommandSurface,
  CommandContextInput,
  CommandDefinition,
  CommandResult,
} from "../types";
import type { ConfirmationProof } from "../runtime/humanConfirmation";

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
      sensitivity
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
      confirmationRequired {
        token
        argsHash
        expiresAt
      }
    }
  }
`;

/**
 * The command registry for one surface, fetched with the active workspace as context and
 * cached per workspace.
 */
export function useCommands(surface?: CommandSurface, commandContext?: CommandContextInput) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceId = commandContext?.workspaceId ?? activeWorkspaceId ?? undefined;
  return useQuery({
    queryKey: queryKeys.commands(surface, workspaceId),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ commands: CommandDefinition[] }>(CommandsDocument, {
        surface: surface ?? "PALETTE",
        commandContext: workspaceId ? { ...commandContext, workspaceId } : commandContext,
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
      isPipe?: boolean;
      confirmation?: ConfirmationProof;
    }) =>
      graphqlClient.request<{ executeCommand: CommandResult }>(ExecuteCommandDocument, {
        input: {
          commandId: input.commandId,
          args: input.args,
          commandContext: input.commandContext,
          isPipe: input.isPipe,
          ...(input.confirmation && { confirmation: input.confirmation }),
        },
      }),
    // A `TIMED_OUT` answer (a mutating command while timed out) switches the composer to its
    // timed-out banner, whichever surface ran the command.
    onError: (err, input) => {
      noteTimedOutError(
        input.commandContext?.workspaceId ?? useWorkspaceStore.getState().workspaceId,
        err,
      );
    },
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
