import { useQuery, useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { routedToWorkspace } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { noteTimedOutError } from "../../workspaces/state/useTimeoutStore";
import type {
  CommandSurface,
  CommandContextInput,
  CommandDefinition,
  CommandResult,
} from "../types";
import type { ConfirmationProof } from "../runtime/humanConfirmation";
import type { CommandInitiator } from "../../../core/graphql/generated/schema-types";

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
      arguments {
        name
        title
        description
        argumentType
        required
        defaultValue
        allowedValues
      }
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
 * The commands the server that hosts the context's workspace lists on `surface` in
 * `commandContext`, fetched now, bypassing the cache.
 */
export async function fetchCommandList(
  surface: CommandSurface,
  commandContext?: CommandContextInput,
): Promise<CommandDefinition[]> {
  const res = await graphqlClient.request<{ commands: CommandDefinition[] }>(
    CommandsDocument,
    routedToWorkspace({ surface, commandContext }, commandContext?.workspaceId),
  );
  return res.commands;
}

/**
 * The command registry for one surface, fetched with the active workspace as context from the
 * server that hosts it, and cached per workspace.
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
      const res = await graphqlClient.request<{ commands: CommandDefinition[] }>(
        CommandsDocument,
        routedToWorkspace(
          {
            surface: surface ?? "PALETTE",
            commandContext: workspaceId ? { ...commandContext, workspaceId } : commandContext,
          },
          workspaceId,
        ),
      );
      return res.commands;
    },
  });
}

/** One command run, as {@link executeCommandAt} sends it. */
export interface ExecuteCommandRequest {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: CommandContextInput;
  isPipe?: boolean;
  confirmation?: ConfirmationProof;
  /** Who started it; the server takes a person's palette run when omitted. */
  initiator?: CommandInitiator;
}

/**
 * Runs a command on the server that hosts the workspace of its `commandContext`; one without a
 * workspace runs on the connected server.
 */
export function executeCommandAt(
  input: ExecuteCommandRequest,
): Promise<{ executeCommand: CommandResult }> {
  return graphqlClient.request<{ executeCommand: CommandResult }>(
    ExecuteCommandDocument,
    routedToWorkspace(
      {
        input: {
          commandId: input.commandId,
          args: input.args,
          commandContext: input.commandContext,
          isPipe: input.isPipe,
          ...(input.confirmation && { confirmation: input.confirmation }),
          ...(input.initiator && { initiator: input.initiator }),
        },
      },
      input.commandContext?.workspaceId,
    ),
  );
}

/**
 * The way a person's run of a command is sent: {@link executeCommandAt} with `initiator`, which
 * records a `TIMED_OUT` answer (a mutating command while timed out) so the composer switches to
 * its timed-out banner, whichever surface ran the command.
 *
 * @param initiator - Who started the run; left out, the server takes a palette run, and a request
 *   that names its own initiator keeps it.
 * @returns A function that sends one run and rethrows its error.
 */
export function executeAsPerson(
  initiator?: CommandInitiator,
): (input: ExecuteCommandRequest) => Promise<{ executeCommand: CommandResult }> {
  return async (input) => {
    try {
      return await executeCommandAt(
        initiator && !input.initiator ? { ...input, initiator } : input,
      );
    } catch (err) {
      noteTimedOutError(
        input.commandContext?.workspaceId ?? useWorkspaceStore.getState().workspaceId,
        err,
      );
      throw err;
    }
  };
}

/**
 * Runs a command a person started, on the server that hosts the workspace of its
 * `commandContext`; one without a workspace runs on the connected server.
 */
export function useExecuteCommandMutation() {
  return useMutation({
    mutationFn: (input: ExecuteCommandRequest) => executeAsPerson()(input),
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
