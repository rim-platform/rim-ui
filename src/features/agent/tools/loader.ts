import { invoke } from "@tauri-apps/api/core";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  CommandExecutionTarget,
  CommandInitiator,
  CommandResultStatus,
  CommandSensitivity,
  CommandSurface,
  type Command,
  type CommandResult,
  type ConfirmationProofInput,
} from "../../../core/graphql/generated/schema-types";
import { runDesktopLocalCommand } from "../../commands/runtime/commandDispatcher";
import { fetchPluginList } from "../../plugins/api/usePluginList";
import { runtimeKind, type PluginCommandInfo, type PluginInfo } from "../../plugins/types";
import { pluginServices } from "../../plugins/web/webPluginEnvironment";
import { webPluginHost } from "../../plugins/web/webPluginHost";
import { detectPlatform } from "../../../core/runtime/runtime";
import type { AiToolDefinition } from "../providers/types";
import { agentEncryptedDeps } from "../encrypted/agentEncryptedDeps";
import { routeEncrypted } from "../encrypted/encryptedTools";
import { ConfirmationRequiredError } from "../runtime/confirmationGate";
import { getCurrentCommandContext } from "./commandContext";
import { registerGetCurrentContextTool } from "./getCurrentContext";
import { buildAiToolFromCommand, buildAiToolRegistrationOptions } from "./generator";
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

// Sent with the active workspace as context, so the AI surface is per workspace just like
// the palette.
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

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Handler for a `DESKTOP_LOCAL` command (Track 4.1). The server rejects desktop-local
 * commands, so the agent runs them through the same local handlers the palette and keybinds
 * use. Tool input follows the server's snake_case argument names (`conversation_id`), while
 * the local handlers read camelCase (`conversationId`), so keys are converted here. These
 * commands only move the user's view, which is why no confirmation applies.
 */
export function makeDesktopLocalToolHandler(commandId: string): AiToolHandler {
  return async (input) => {
    const args = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [snakeToCamel(key), value]),
    );
    if (!runDesktopLocalCommand(commandId, args)) {
      throw new Error(`${commandId} is not available in this client`);
    }
    return JSON.stringify({ status: "done", commandId });
  };
}

/**
 * Desktop-local commands never reach the server's confirmation gate, so only Safe,
 * non-dangerous ones run locally. Anything stricter goes to `executeCommand`, where the
 * server refuses it rather than letting the agent skip a confirmation.
 */
function isUnconfirmedLocalCommand(cmd: Command): boolean {
  return (
    cmd.executionTarget === CommandExecutionTarget.DESKTOP_LOCAL &&
    cmd.sensitivity === CommandSensitivity.SAFE &&
    !cmd.dangerous
  );
}

export function commandsToBackendTools(commands: ReadonlyArray<Command>): BackendTool[] {
  return commands.map((cmd) => ({
    definition: buildAiToolFromCommand(cmd),
    handler: isUnconfirmedLocalCommand(cmd)
      ? makeDesktopLocalToolHandler(cmd.id)
      : makeBackendToolHandler(cmd.id),
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

/** Model APIs accept tool names matching this; plugin ids have dots. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ARGUMENT_TYPES = new Set(["string", "integer", "number", "boolean", "object", "array"]);

/**
 * The agent's tool name for a plugin command. Plugin ids may not contain
 * underscores, so turning their dots into underscores keeps names distinct.
 * `null` when the name would still be one a model API refuses.
 */
export function pluginToolName(pluginId: string, commandId: string): string | null {
  const name = `plugin__${pluginId.replace(/\./g, "_")}__${commandId}`;
  return TOOL_NAME_PATTERN.test(name) ? name : null;
}

export function buildPluginToolDefinition(
  name: string,
  pluginName: string,
  command: PluginCommandInfo,
): AiToolDefinition {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const argument of command.arguments) {
    properties[argument.name] = {
      ...(argument.type && ARGUMENT_TYPES.has(argument.type) ? { type: argument.type } : {}),
      ...(argument.description ? { description: argument.description } : {}),
    };
    if (argument.required) required.push(argument.name);
  }
  const description = [
    `${command.title} (${pluginName} plugin). ${command.description}`.trim(),
    command.dangerous
      ? "This command is dangerous: you cannot run it. Calling it only proposes it to the user, who must run and confirm it themselves."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    name,
    description,
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

/** What the agent learns when it calls a dangerous plugin command: it was proposed, not run. */
function proposalForUser(pluginName: string, command: PluginCommandInfo): string {
  return JSON.stringify({
    status: "not_run",
    reason: "needs_user_confirmation",
    message:
      `"${command.title}" is dangerous, so only the user can run it, after confirming. ` +
      `Tell them what you propose and why; they can run it from the ${pluginName} panel.`,
  });
}

/**
 * Run a plugin command for the agent: through the Rust host's consent gates for
 * a local process, or, for a web plugin, those same gates and then the web
 * plugin host in this page.
 */
async function runAiCommand(
  pluginId: string,
  command: PluginCommandInfo,
  input: unknown,
  web: boolean,
) {
  if (!web)
    return invoke<unknown>("plugin_run_ai_command", { pluginId, commandId: command.id, input });
  await pluginServices(detectPlatform()).checkAiConsent(pluginId, command.id);
  const output = await webPluginHost.execute({
    pluginId,
    commandId: command.id,
    args: input,
    initiator: "agent",
  });
  return output.payload;
}

function makePluginToolHandler(
  pluginId: string,
  pluginName: string,
  command: PluginCommandInfo,
  web = false,
): AiToolHandler {
  return async (input) => {
    try {
      const result = await runAiCommand(pluginId, command, input, web);
      return payloadToString(result);
    } catch (err) {
      // The host refuses every dangerous command the agent starts: the agent
      // can propose one, never confirm it.
      if (typeof err === "object" && err !== null && "kind" in err) {
        if ((err as { kind: unknown }).kind === "CONFIRMATION_REQUIRED") {
          return proposalForUser(pluginName, command);
        }
      }
      // The host rejects with `{ kind, message }`; String() would print "[object Object]".
      const reason =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      throw new Error(`Plugin command ${pluginId}/${command.id} failed: ${reason}`, {
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

      const command: PluginCommandInfo = plugin.commands?.find((c) => c.id === commandId) ?? {
        id: commandId,
        qualified_id: `plugin.${plugin.manifest_id}.${commandId}`,
        title: commandId,
        description: "",
        keybind_capable: false,
        dangerous: false,
        ai_callable: true,
        arguments: [],
      };
      const name = pluginToolName(plugin.manifest_id, commandId);
      if (!name) {
        console.warn(`[agent.loader] ${command.qualified_id} has no valid tool name; not offered`);
        continue;
      }
      registerTool(
        buildPluginToolDefinition(name, plugin.display_name, command),
        makePluginToolHandler(
          plugin.manifest_id,
          plugin.display_name,
          command,
          runtimeKind(plugin) === "WebSandboxed",
        ),
      );
    }
  }
}

export async function loadAgentTools(): Promise<MergeResult> {
  // Snapshot the intended hardcoded set, then clear the registry so we can
  // re-populate atomically. This makes loadAgentTools idempotent — calling
  // it twice never leaves a dropped builtin handler shadowing a backend
  // winner under the same name.
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
    // In an end-to-end encrypted conversation the chat tools work on this device.
    registerTool(
      tool.definition,
      routeEncrypted(tool.definition.name, tool.handler, agentEncryptedDeps),
      tool.options,
    );
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
