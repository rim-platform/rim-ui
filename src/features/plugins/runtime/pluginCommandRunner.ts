// Runs the app's own commands for plugins: the one place every check a plugin's request
// passes lives, whichever host it came from (a panel, a local process, a web plugin).

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  CommandInitiator,
  CommandSensitivity,
  type ConfirmationChallenge,
  type ConfirmationProofInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { hostDialogOpen } from "../../../shared/ui/hostDialogs";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { fetchCommandList } from "../../commands/api/useCommands";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "../../commands/runtime/appCommands/agentCommandIds";
import {
  argString,
  argumentPromptName,
  runLocalCommandForCaller,
} from "../../commands/runtime/commandDispatcher";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { withClientLabel, LOCAL_COMMANDS } from "../../commands/runtime/localCommands";
import { offeredLocalCommands } from "../../commands/runtime/offeredLocalCommands";
import { CONFIRMATION_STALE } from "../../commands/runtime/humanConfirmation";
import type { CommandContextInput, CommandDefinition } from "../../commands/types";
import { findCachedConversation } from "../../conversations/api/useConversation";
import { routedToWorkspace } from "../../relay/state/useRelayStore";
import { fetchPluginList } from "../api/usePluginList";
import { recordPluginCommandRun } from "../api/pluginCommandGrants";
import { usePluginConfirmStore } from "../state/usePluginConfirmStore";
import type { PluginInfo } from "../types";
import { relativeBanRefusal } from "../../commands/runtime/relativeBanGuard";
import { isCommandId, unrunnableByPlugins } from "../../../../sdk/plugin-sdk/src/manifestRules";

/** Why the app did not run a command a plugin asked for. */
export type PluginRunRefusal =
  | "NOT_ALLOWED"
  | "NOT_GRANTED"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "COOLING_DOWN"
  | "BUSY"
  | "CONFIRMATION_DISMISSED";

/** What a plugin hears about a run it asked for: how it ended, never the command's output. */
export interface PluginRunResult {
  status: "success" | "error" | "refused";
  /**
   * On a refusal, why it did not run; on an error, the command's own error code, such as
   * `VALIDATION`, when the server gave one.
   */
  code?: PluginRunRefusal | (string & {});
  message?: string;
}

/** How many commands a minute one plugin may ask for. */
export const PLUGIN_COMMANDS_PER_MINUTE = 20;
/** How long a plugin waits after the person dismissed one of its cards before it may ask again. */
export const PLUGIN_COOLDOWN_MS = 60_000;

const MINUTE_MS = 60_000;

/** The argument names whose ids replace the person's current context, per context field. */
const CONTEXT_ARGUMENTS = {
  workspaceId: ["workspace_id", "workspaceId", "server_id", "serverId"],
  conversationId: ["conversation_id", "conversationId"],
  threadId: ["thread_id", "threadId"],
} as const;

/** `executeCommand` as a plugin's runs send it: no output is ever selected. */
const PLUGIN_EXECUTE_COMMAND = gql`
  mutation PluginExecuteCommand($input: ExecuteCommandInput!) {
    executeCommand(input: $input) {
      status
      message
      confirmationRequired {
        token
        argsHash
        expiresAt
      }
    }
  }
`;

interface ServerAnswer {
  status: string;
  message: string;
  confirmationRequired?: ConfirmationChallenge | null;
}

/** What the runner reads and does outside itself; tests replace each part. */
export interface RunnerDeps {
  now(): number;
  /** The installed plugins as their store holds them now. */
  plugins(): Promise<PluginInfo[]>;
  /** The built-in commands the server offers in `context`, fetched now. */
  serverCommands(context: CommandContextInput): Promise<CommandDefinition[]>;
  /** The app commands offered here. */
  appCommands(): readonly CommandDefinition[];
  /** The person's current context. */
  context(): CommandContextInput;
  /** Sends `executeCommand` with initiator `PLUGIN`. */
  execute(input: {
    commandId: string;
    args: Record<string, unknown>;
    commandContext: CommandContextInput;
    confirmation?: ConfirmationProofInput;
  }): Promise<ServerAnswer>;
  /** Runs an app command's local handler: `null` when it has none. */
  runLocal(
    commandId: string,
    args: Record<string, unknown>,
    commandContext: CommandContextInput,
  ): Promise<{ ok: boolean; message: string } | null> | { ok: boolean; message: string } | null;
  /** Whether a confirmation or another host dialog is open now. */
  busy(): boolean;
  /** Asks the person in a card naming the plugin; `true` on yes. */
  confirm(request: {
    pluginName: string;
    commandTitle: string;
    description: string;
    args: Record<string, unknown>;
    target: string | null;
    expiresAt: string;
  }): Promise<"approved" | "dismissed" | "expired">;
  /** Records the run in the plugin's audit. */
  record(
    pluginId: string,
    commandId: string,
    outcome: PluginRunResult["status"],
    code?: string,
  ): Promise<unknown>;
}

function refused(code: PluginRunRefusal, message: string): PluginRunResult {
  return { status: "refused", code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The context a plugin's run acts in: the person's workspace, conversation and thread, never
 * their selected message or focused surface, with ids in `args` in place of the person's. A
 * conversation from the args drops the person's thread, and a workspace from the args drops
 * the person's conversation, since neither belongs to the place the args name.
 */
export function pluginCommandContext(
  current: CommandContextInput,
  args: Record<string, unknown>,
): CommandContextInput {
  const workspaceId = argString(args, ...CONTEXT_ARGUMENTS.workspaceId);
  const conversationId = argString(args, ...CONTEXT_ARGUMENTS.conversationId);
  const threadId = argString(args, ...CONTEXT_ARGUMENTS.threadId);
  const context: CommandContextInput = {};
  const workspace = workspaceId ?? current.workspaceId;
  if (workspace) context.workspaceId = workspace;
  const conversation =
    conversationId ??
    (workspaceId && workspaceId !== current.workspaceId ? undefined : current.conversationId);
  if (conversation) context.conversationId = conversation;
  const thread =
    threadId ??
    (conversation && conversation === current.conversationId ? current.threadId : undefined);
  if (thread) context.threadId = thread;
  return context;
}

/** Counts calls per plugin in fixed one-minute windows. */
class PerMinute {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /** Count one call of `key`; false once it is over `limit` this minute. */
  take(key: string, limit: number, now: number): boolean {
    const window = this.windows.get(key);
    if (!window || now - window.start >= MINUTE_MS) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  }
}

/** A runner over `deps`, with its own rate limits and cooldowns. */
export function createPluginCommandRunner(deps: RunnerDeps) {
  const calls = new PerMinute();
  const coolingUntil = new Map<string, number>();

  async function run(
    plugin: PluginInfo | undefined,
    pluginId: string,
    commandId: string,
    args: Record<string, unknown>,
  ): Promise<PluginRunResult> {
    if (!calls.take(pluginId, PLUGIN_COMMANDS_PER_MINUTE, deps.now())) {
      return refused("RATE_LIMITED", "too many commands this minute; try again shortly");
    }
    if (!isCommandId(commandId)) return refused("NOT_ALLOWED", "not a command id");
    const never = unrunnableByPlugins(commandId);
    if (never !== null || AGENT_MANAGEMENT_COMMAND_IDS.has(commandId)) {
      return refused(
        "NOT_ALLOWED",
        never ?? "answering and managing agents is the person's own act",
      );
    }
    if (
      !plugin ||
      !plugin.enabled ||
      !(plugin.runs_commands ?? []).includes(commandId) ||
      !(plugin.granted_commands ?? []).includes(commandId)
    ) {
      return refused("NOT_GRANTED", "the person has not let this plugin run this command");
    }
    const context = pluginCommandContext(deps.context(), args);

    // An app command never comes from the server's list, whatever the list holds.
    const appCommand = LOCAL_COMMANDS.find((c) => c.id === commandId);
    if (appCommand) {
      if (!appCommand.pluginRunnable) {
        return refused("NOT_ALLOWED", "plugins can't run this command");
      }
      if (!deps.appCommands().some((c) => c.id === commandId)) {
        return refused("UNAVAILABLE", "this command is not offered here");
      }
      return runLocally(commandId, args, context);
    }

    let listed: CommandDefinition | undefined;
    try {
      listed = (await deps.serverCommands(context)).find((c) => c.id === commandId);
    } catch (error) {
      logger.warn("[RIM:Plugin] could not list the server's commands", error);
      return { status: "error", message: "could not reach the workspace" };
    }
    if (!listed) return refused("UNAVAILABLE", "this command is not offered here");
    if (listed.sourceKind !== "BUILT_IN") {
      return refused("NOT_ALLOWED", "plugins run only built-in commands");
    }
    if (listed.dangerous || listed.sensitivity === CommandSensitivity.RESTRICTED) {
      return refused("NOT_ALLOWED", "plugins can't run this command");
    }
    if (listed.executionTarget === "DESKTOP_LOCAL") {
      if (listed.sensitivity !== CommandSensitivity.SAFE) {
        return refused("NOT_ALLOWED", "plugins can't run this command");
      }
      return runLocally(commandId, args, context);
    }
    return runOnServer(plugin, listed, args, context);
  }

  async function runLocally(
    commandId: string,
    args: Record<string, unknown>,
    context: CommandContextInput,
  ): Promise<PluginRunResult> {
    // Plugin runs show no argument form: a command missing what its picker would ask for fails.
    const prompted = argumentPromptName(commandId);
    if (prompted && !argString(args, prompted, camelCase(prompted))) {
      return { status: "error", message: `missing argument: ${prompted}` };
    }
    try {
      const outcome = await deps.runLocal(commandId, args, context);
      if (outcome === null) return refused("UNAVAILABLE", "this command is not offered here");
      return outcome.ok
        ? { status: "success", ...(outcome.message ? { message: outcome.message } : {}) }
        : { status: "error", message: outcome.message || "the command failed" };
    } catch (error) {
      logger.warn(`[RIM:Plugin] ${commandId} failed`, error);
      return { status: "error", message: "the command failed" };
    }
  }

  async function runOnServer(
    plugin: PluginInfo,
    command: CommandDefinition,
    args: Record<string, unknown>,
    context: CommandContextInput,
  ): Promise<PluginRunResult> {
    const send = (confirmation?: ConfirmationProofInput) =>
      deps.execute({
        commandId: command.id,
        args,
        commandContext: context,
        ...(confirmation ? { confirmation } : {}),
      });
    let answer: ServerAnswer;
    try {
      answer = await send();
    } catch (error) {
      return serverError(error);
    }
    if (answer.status === "CONFIRMATION_REQUIRED") {
      const challenge = answer.confirmationRequired;
      if (!challenge) return { status: "error", message: "the command needs a confirmation" };
      const until = coolingUntil.get(plugin.plugin_id);
      if (until !== undefined && deps.now() < until) {
        return refused("COOLING_DOWN", "the person dismissed this plugin's last request");
      }
      if (deps.busy()) return refused("BUSY", "another confirmation is open");
      const label = withClientLabel(command);
      const decision = await deps.confirm({
        pluginName: showInvisibleCharacters(plugin.display_name || plugin.plugin_id),
        commandTitle: label.title || command.id,
        description: label.description,
        args,
        target: targetOf(context),
        expiresAt: challenge.expiresAt,
      });
      if (decision === "dismissed") {
        coolingUntil.set(plugin.plugin_id, deps.now() + PLUGIN_COOLDOWN_MS);
        return refused("CONFIRMATION_DISMISSED", "the person did not let it run");
      }
      if (decision === "expired") return { status: "error", message: "the confirmation expired" };
      try {
        answer = await send({
          inBandToken: { token: challenge.token, argsHash: challenge.argsHash },
        });
      } catch (error) {
        if (graphqlErrorCode(error) === CONFIRMATION_STALE) {
          return { status: "error", message: "the confirmation expired" };
        }
        return serverError(error);
      }
      if (answer.status === "CONFIRMATION_REQUIRED") {
        return { status: "error", message: "the server did not accept the confirmation" };
      }
    }
    return answer.status === "SUCCESS"
      ? { status: "success", ...(answer.message ? { message: answer.message } : {}) }
      : { status: "error", message: answer.message || "the command failed" };
  }

  return {
    /**
     * Runs `commandId` for `pluginId` after every check: not another plugin's command or an
     * agent command, granted and the plugin on, offered here, a built-in neither dangerous
     * nor `RESTRICTED` or an app command marked runnable by plugins, within the per-minute
     * limit and outside a cooldown. Records the run in the plugin's audit, except a call over
     * the limit.
     *
     * @param args - The plugin's arguments; anything but an object counts as none.
     * @returns How the run ended, never the command's output.
     */
    async runCommandForPlugin(
      pluginId: string,
      commandId: unknown,
      args?: unknown,
    ): Promise<PluginRunResult> {
      const id = typeof commandId === "string" ? commandId : "";
      const plainArgs = isRecord(args) ? args : {};
      let plugin: PluginInfo | undefined;
      let result: PluginRunResult;
      try {
        plugin = (await deps.plugins()).find((p) => p.plugin_id === pluginId);
        result = await run(plugin, pluginId, id, plainArgs);
      } catch (error) {
        logger.warn(`[RIM:Plugin] ${pluginId} could not run ${id}`, error);
        result = { status: "error", message: "the command failed" };
      }
      if (result.code !== "RATE_LIMITED" && plugin) {
        const code = result.code && ERROR_CODE.test(result.code) ? result.code : undefined;
        const failed = await deps.record(pluginId, id, result.status, code);
        if (failed) logger.warn(`[RIM:Plugin] run of ${id} by ${pluginId} not recorded`, failed);
      }
      return result;
    },
  };
}

function camelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The shape of an error code a run passes on: capital letters and underscores, as the server's. */
const ERROR_CODE = /^[A-Z_]{1,32}$/;

/** A command the server refused with an error, with its error code when it gave one. */
function serverError(error: unknown): PluginRunResult {
  const code = graphqlErrorCode(error);
  const message = graphqlErrorMessage(error, "the command failed");
  return {
    status: "error",
    ...(code && ERROR_CODE.test(code) ? { code } : {}),
    message,
  };
}

/** The conversation a run acts in, by its name where this app knows it. */
function targetOf(context: CommandContextInput): string | null {
  if (!context.conversationId) return null;
  const conversation = findCachedConversation(
    queryClient,
    context.workspaceId,
    context.conversationId,
  );
  return conversation?.title ? showInvisibleCharacters(conversation.title) : context.conversationId;
}

/**
 * Shows the plugin's card and settles it when the challenge expires.
 *
 * @returns `approved`, `dismissed`, or `expired` when the card was still open at expiry.
 */
async function confirmInCard(request: Parameters<RunnerDeps["confirm"]>[0]) {
  const store = usePluginConfirmStore.getState();
  let expired = false;
  const delay = Date.parse(request.expiresAt) - Date.now();
  const timer =
    Number.isFinite(delay) && delay < 2 ** 31
      ? setTimeout(
          () => {
            expired = true;
            usePluginConfirmStore.getState().cancel();
          },
          Math.max(delay, 0),
        )
      : undefined;
  const confirmed = await store.ask({
    pluginName: request.pluginName,
    commandTitle: request.commandTitle,
    description: request.description,
    args: request.args,
    runsAppCommand: { target: request.target },
  });
  clearTimeout(timer);
  if (confirmed) return "approved" as const;
  return expired ? ("expired" as const) : ("dismissed" as const);
}

/** The runner wired to this app. */
const appRunner = createPluginCommandRunner({
  now: () => Date.now(),
  plugins: () => fetchPluginList(),
  serverCommands: async (context) => {
    const lists = await Promise.all([
      fetchCommandList("PALETTE", context),
      fetchCommandList("KEYBIND_PICKER", context),
    ]);
    return lists.flat();
  },
  appCommands: () => offeredLocalCommands(new Set()),
  context: () => currentCommandContext(),
  execute: async ({ commandId, args, commandContext, confirmation }) => {
    const refusal = await relativeBanRefusal(commandId, args, commandContext.workspaceId);
    if (refusal) return { status: "ERROR", message: refusal };
    const res = await graphqlClient.request<{ executeCommand: ServerAnswer }>(
      PLUGIN_EXECUTE_COMMAND,
      routedToWorkspace(
        {
          input: {
            commandId,
            args,
            commandContext,
            initiator: CommandInitiator.PLUGIN,
            ...(confirmation ? { confirmation } : {}),
          },
        },
        commandContext.workspaceId,
      ),
    );
    return res.executeCommand;
  },
  runLocal: runLocalCommandForCaller,
  busy: () =>
    usePluginConfirmStore.getState().request !== null ||
    useConfirmationModalStore.getState().request !== null ||
    hostDialogOpen(),
  confirm: confirmInCard,
  record: (pluginId, commandId, outcome, code) =>
    recordPluginCommandRun(pluginId, commandId, outcome, code),
});

/**
 * Runs one of the app's own commands for `pluginId`; see
 * {@link createPluginCommandRunner}. Answers every plugin host's `rim.command.execute`.
 */
export function runCommandForPlugin(
  pluginId: string,
  commandId: unknown,
  args?: unknown,
): Promise<PluginRunResult> {
  return appRunner.runCommandForPlugin(pluginId, commandId, args);
}
