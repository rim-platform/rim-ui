import { invoke } from "@tauri-apps/api/core";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  CommandInitiator,
  CommandResultStatus,
  CommandSurface,
  type Command,
  type CommandResult,
  type ConfirmationProofInput,
} from "../../../core/graphql/generated/schema-types";
import { fetchPluginList } from "../../plugins/api/usePluginList";
import type { PluginInfo } from "../../plugins/types";
import type { AiToolDefinition } from "../providers/types";
import { ConfirmationRequiredError } from "../runtime/confirmationGate";
import { getCurrentCommandContext } from "./commandContext";
import { registerGetCurrentContextTool } from "./getCurrentContext";
import { buildAiToolFromCommand, buildAiToolRegistrationOptions } from "./generator";
import { invalidateAfterCommand } from "./postExecution";
import { registerTool, getAllTools, getTool, unregisterTool } from "./registry";
import type { AiToolHandler, RegisteredTool } from "./types";

function clearRegistry(): void {
  for (const tool of getAllTools()) {
    unregisterTool(tool.definition.name);
  }
}

// confirmationRequired is the server-issued challenge populated iff
// status == CONFIRMATION_REQUIRED. Without these subfields selected, the
// modal never opens for dangerous commands — interpretResult throws the
// "challenge payload missing" branch and H1 closure is theoretical only.
// This selection set must stay exhaustive; losing any of {token, argsHash,
// expiresAt} breaks the in-band-proof flow.
const EXECUTE_COMMAND_MUTATION = gql`
  mutation AgentExecuteCommand($input: ExecuteCommandInput!) {
    executeCommand(input: $input) {
      status
      message
      payload
      confirmationRequired {
        token
        argsHash
        expiresAt
      }
    }
  }
`;

// Sent with the active workspace as context (Track 0.4): the server drops commands whose
// workspace feature is off and hides feature-gated commands entirely when no workspace is
// given, so the AI surface is per workspace just like the palette.
const AI_COMMANDS_QUERY = gql`
  query AgentListAiCommands($commandContext: CommandContextInput) {
    commands(surface: AI, commandContext: $commandContext) {
      id
      title
      description
      nlDescription
      intentSamples
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
      aiCallable
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

interface BackendTool {
  definition: AiToolDefinition;
  handler: AiToolHandler;
  options: ReturnType<typeof buildAiToolRegistrationOptions>;
}

export interface MergeResult {
  winners: AiToolDefinition[];
  droppedBuiltinNames: string[];
}

export function mergeBackendWins(
  hardcoded: ReadonlyArray<RegisteredTool>,
  backend: ReadonlyArray<BackendTool>,
): MergeResult {
  const backendNames = new Set(backend.map((t) => t.definition.name));
  const droppedBuiltinNames: string[] = [];
  const winners: AiToolDefinition[] = [];

  for (const tool of hardcoded) {
    if (backendNames.has(tool.definition.name)) {
      droppedBuiltinNames.push(tool.definition.name);
      continue;
    }
    winners.push(tool.definition);
  }
  for (const tool of backend) {
    winners.push(tool.definition);
  }

  return { winners, droppedBuiltinNames };
}

function payloadToString(payload: unknown): string {
  if (payload === null || payload === undefined) return "{}";
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

async function callExecuteCommand(
  commandId: string,
  args: Record<string, unknown>,
  confirmation?: ConfirmationProofInput,
): Promise<CommandResult> {
  const commandContext = getCurrentCommandContext();
  const res = await graphqlClient.request<{ executeCommand: CommandResult }>(
    EXECUTE_COMMAND_MUTATION,
    {
      input: {
        commandId,
        args,
        initiator: CommandInitiator.AGENT,
        ...(confirmation ? { confirmation } : {}),
        ...(commandContext ? { commandContext } : {}),
      },
    },
  );
  return res.executeCommand;
}

/**
 * Re-invocation thunk for the confirmation gate. Posts the original args plus
 * a server-issued proof. Used by `confirmationGate.runWithConfirmation` after
 * the modal resolves with `approved: true`.
 *
 * Returns the executed payload as a string on SUCCESS; throws
 * `ConfirmationRequiredError` if the server re-issues a fresh challenge
 * (stale-token retry path); throws plain Error on any other non-SUCCESS
 * status (USER_ERROR / SERVER_ERROR / etc.).
 */
export async function executeCommandWithProof(
  commandId: string,
  args: Record<string, unknown>,
  toolName: string,
  proof: { token: string; argsHash: string },
): Promise<string> {
  const result = await callExecuteCommand(commandId, args, {
    inBandToken: { token: proof.token, argsHash: proof.argsHash },
  });
  return interpretResult(commandId, args, toolName, result);
}

function interpretResult(
  commandId: string,
  args: Record<string, unknown>,
  toolName: string,
  result: CommandResult,
): string {
  if (result.status === CommandResultStatus.SUCCESS) {
    // Agent tool calls bypass commandDispatcher entirely, so this is the
    // only choke point for cache invalidation on this path (covers both the
    // one-shot call and the post-confirmation-proof re-call, since
    // executeCommandWithProof flows through here too). Scoped to the two C2
    // incident commands only — see postExecution.ts doc comment.
    invalidateAfterCommand(commandId, args);
    return payloadToString(result.payload);
  }
  if (result.status === CommandResultStatus.CONFIRMATION_REQUIRED) {
    if (!result.confirmationRequired) {
      throw new Error("CONFIRMATION_REQUIRED status returned without a challenge payload");
    }
    // Enrich the challenge with registry-side context so the modal can
    // render sensitivity tier + nl_description without a second lookup.
    // The tool is keyed by commandId (backend handlers register under
    // their commandId) — for hardcoded tools (e.g. get_current_context)
    // we won't find a record and the modal falls back to defaults.
    const registered = getTool(commandId);
    throw new ConfirmationRequiredError({
      commandId,
      toolName,
      args,
      token: result.confirmationRequired.token,
      argsHash: result.confirmationRequired.argsHash,
      expiresAt: result.confirmationRequired.expiresAt,
      sensitivity: registered?.sensitivity,
      nlDescription: registered?.nlDescription,
      description: registered?.description,
      serverMessage: result.message,
    });
  }
  throw new Error(result.message ?? "Command execution failed");
}

export function makeBackendToolHandler(commandId: string): AiToolHandler {
  return async (input) => {
    const result = await callExecuteCommand(commandId, input);
    return interpretResult(commandId, input, commandId, result);
  };
}

export function commandsToBackendTools(commands: ReadonlyArray<Command>): BackendTool[] {
  return commands.map((cmd) => ({
    definition: buildAiToolFromCommand(cmd),
    handler: makeBackendToolHandler(cmd.id),
    options: buildAiToolRegistrationOptions(cmd),
  }));
}

async function fetchAiCommands(): Promise<Command[]> {
  // Only the workspace matters for the registry; conversation/thread context would just
  // churn the tool list on every navigation.
  const workspaceId = getCurrentCommandContext()?.workspaceId;
  const res = await graphqlClient.request<{ commands: Command[] }>(
    AI_COMMANDS_QUERY,
    workspaceId ? { commandContext: { workspaceId } } : {},
  );
  return res.commands;
}

function buildPluginToolDefinition(
  pluginId: string,
  commandId: string,
  title: string,
  description: string,
): AiToolDefinition {
  return {
    name: `plugin__${pluginId}__${commandId}`,
    description,
    input_schema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: `Free-form input passed to ${title}`,
        },
      },
      required: [],
      additionalProperties: false,
    },
  };
}

function makePluginToolHandler(pluginId: string, commandId: string): AiToolHandler {
  return async (input) => {
    try {
      const result = await invoke<unknown>("plugin_run_ai_command", { pluginId, commandId, input });
      return payloadToString(result);
    } catch (err) {
      // The host rejects with `{ kind, message }`; String() would print "[object Object]".
      const reason =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      throw new Error(`Plugin command ${pluginId}/${commandId} failed: ${reason}`, {
        cause: err,
      });
    }
  };
}

function injectPluginTools(plugins: ReadonlyArray<PluginInfo>): void {
  for (const plugin of plugins) {
    // enabled is derived server-side; skip disabled or consent-pending plugins.
    if (!plugin.enabled || plugin.ai_consent_required) continue;
    if (plugin.approved_ai_commands.length === 0) continue;

    // approved_ai_commands is the user-consented subset of ai_callable_commands.
    const approvedSet = new Set(plugin.approved_ai_commands);

    for (const commandId of plugin.ai_callable_commands) {
      if (!approvedSet.has(commandId)) continue;

      const definition = buildPluginToolDefinition(
        plugin.manifest_id,
        commandId,
        commandId,
        `Plugin command ${commandId} from ${plugin.display_name}`,
      );
      registerTool(definition, makePluginToolHandler(plugin.manifest_id, commandId));
    }
  }
}

export async function loadAgentTools(): Promise<MergeResult> {
  // Snapshot the intended hardcoded set, then clear the registry so we can
  // re-populate atomically. This makes loadAgentTools idempotent — calling
  // it twice never leaves a dropped builtin handler shadowing a backend
  // winner under the same name (Hawkeye P2-B5 WARN).
  //
  // Post-#55 the hardcoded set is exactly one tool — `get_current_context`,
  // the documented carve-out (see `getCurrentContext.ts` for rationale).
  // Every other AI-callable command comes from the backend registry.
  registerGetCurrentContextTool();
  const hardcodedSnapshot = getAllTools();
  clearRegistry();

  let backendCommands: Command[] = [];
  let fetchFailed = false;
  try {
    backendCommands = await fetchAiCommands();
  } catch (err) {
    // Network/server failure: fall back to hardcoded-only registry.
    // Do NOT block agent boot — the user can still use builtin tools.
    fetchFailed = true;

    console.warn("[agent.loader] Failed to fetch backend AI tools, using hardcoded only", err);
  }

  if (fetchFailed) {
    for (const tool of hardcodedSnapshot) {
      registerTool(tool.definition, tool.handler, {
        sideEffect: tool.sideEffect,
        requiresConfirmation: tool.requiresConfirmation,
        sensitivity: tool.sensitivity,
        description: tool.description,
      });
    }
    return {
      winners: hardcodedSnapshot.map((t) => t.definition),
      droppedBuiltinNames: [],
    };
  }

  const backendTools = commandsToBackendTools(backendCommands);
  const result = mergeBackendWins(hardcodedSnapshot, backendTools);
  const droppedSet = new Set(result.droppedBuiltinNames);

  for (const tool of hardcodedSnapshot) {
    if (droppedSet.has(tool.definition.name)) continue;
    registerTool(tool.definition, tool.handler, {
      sideEffect: tool.sideEffect,
      requiresConfirmation: tool.requiresConfirmation,
      sensitivity: tool.sensitivity,
      description: tool.description,
    });
  }
  for (const tool of backendTools) {
    registerTool(tool.definition, tool.handler, tool.options);
  }

  try {
    const plugins = await fetchPluginList();
    injectPluginTools(plugins);
  } catch {
    // Plugin host unavailable — agent still works without plugin tools.
  }

  return result;
}

// Re-exports for tests / consumers
export { CommandSurface };
