import {
  CommandArgumentType,
  CommandInitiator,
} from "../../../core/graphql/generated/schema-types";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { executeCommandAt } from "../../commands/api/useCommands";
import { camelCaseName } from "../../commands/runtime/commandArguments";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { LOCAL_COMMANDS } from "../../commands/runtime/localCommands";
import { useCommandArgumentsStore } from "../../commands/state/useCommandArgumentsStore";
import type {
  CommandArgumentInfo,
  CommandContextInput,
  CommandDefinition,
  CommandResult,
} from "../../commands/types";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";
import { findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import { noteTimedOutError } from "../../workspaces/state/useTimeoutStore";
import {
  fetchAccountMacros,
  fetchMacroStepCommands,
  type AccountMacro,
  type AccountMacroStep,
} from "../api/useAccountMacros";
import { isMacroId, macroRegistry, stepTitle, type MacroRegistry } from "./macroCommands";

/** How many macros a chain of macros naming macros may hold. */
export const MAX_MACRO_DEPTH = 8;

/** How many steps one run of a macro may perform, its nested macros' steps included. */
export const MAX_MACRO_STEPS = 100;

/** A step of a macro run, nested macros expanded. */
interface PlannedStep {
  commandId: string;
  args: Record<string, unknown>;
  ask: readonly string[];
}

/** Why a macro cannot run at all, before any of its steps. */
class MacroRefused extends Error {}

function argsOf(step: AccountMacroStep): Record<string, unknown> {
  const args = step.args as unknown;
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/**
 * The steps `macro` runs, in order, each nested macro's steps in its place.
 *
 * @throws {MacroRefused} When a nested macro is gone or turned off, the chain of macros is
 *   longer than {@link MAX_MACRO_DEPTH} or names a macro twice, or the run would perform more
 *   than {@link MAX_MACRO_STEPS} steps.
 */
function plannedSteps(macro: AccountMacro, registry: MacroRegistry): PlannedStep[] {
  const planned: PlannedStep[] = [];
  const expand = (current: AccountMacro, chain: readonly string[]) => {
    if (chain.length > MAX_MACRO_DEPTH) {
      throw new MacroRefused(`it nests more than ${MAX_MACRO_DEPTH} macros deep`);
    }
    for (const step of current.steps) {
      if (isMacroId(step.commandId)) {
        if (chain.includes(step.commandId)) {
          throw new MacroRefused("it runs itself through one of its steps");
        }
        const nested = registry.macro(step.commandId);
        if (!nested || !nested.isEnabled) {
          throw new MacroRefused(
            `a step runs a macro that is gone or turned off (${step.commandId})`,
          );
        }
        expand(nested, [...chain, nested.id]);
        continue;
      }
      planned.push({ commandId: step.commandId, args: argsOf(step), ask: step.ask ?? [] });
      if (planned.length > MAX_MACRO_STEPS) {
        throw new MacroRefused(`it runs more than ${MAX_MACRO_STEPS} steps`);
      }
    }
  };
  expand(macro, [macro.id]);
  return planned;
}

/** The type of an asked argument a step's command does not declare, from its name. */
function typeFromName(name: string): CommandArgumentType {
  switch (name) {
    case "conversation_id":
    case "conversationId":
      return CommandArgumentType.CONVERSATION_ID;
    case "workspace_id":
    case "workspaceId":
    case "server_id":
    case "serverId":
      return CommandArgumentType.WORKSPACE_ID;
    case "user_id":
    case "userId":
      return CommandArgumentType.USER_ID;
    default:
      return CommandArgumentType.STRING;
  }
}

/** The field an argument a step asks for is filled in, named `<step index>:<name>`. */
function askedField(
  index: number,
  name: string,
  command: CommandDefinition | undefined,
  title: string,
): CommandArgumentInfo {
  const declared = command?.arguments?.find(
    (argument) => argument.name === name || camelCaseName(argument.name) === name,
  );
  const pluginArgument =
    command?.sourceKind === "PLUGIN"
      ? findPluginCommand(command.id)?.arguments.find((argument) => argument.name === name)
      : undefined;
  const label = `Step ${index + 1} · ${title}: ${declared?.title || name}`;
  if (declared) return { ...declared, name: `${index}:${name}`, title: label };
  return {
    name: `${index}:${name}`,
    title: label,
    argumentType: typeFromName(name),
    required: pluginArgument?.required ?? true,
    ...(pluginArgument?.description ? { description: pluginArgument.description } : {}),
  };
}

/** The values the form gave for step `index`, by argument name, leaving out empty ones. */
function askedValues(index: number, values: Record<string, unknown>): Record<string, unknown> {
  const prefix = `${index}:`;
  return Object.fromEntries(
    Object.entries(values)
      .filter(([field, value]) => field.startsWith(prefix) && value !== undefined && value !== "")
      .map(([field, value]) => [field.slice(prefix.length), value]),
  );
}

function stepFailed(index: number, title: string, reason: string): void {
  toast.error(`Step ${index + 1} (${title}) failed: ${reason}`);
}

/**
 * Runs one of the person's macros, step by step, and says how it went. Every argument the steps
 * ask for is asked in one form first; cancelling it runs nothing. Each step then runs as it would
 * from the palette, with the context the run started in: a server step on the server that hosts
 * the workspace, with initiator `MACRO`, its own confirmation and audit entry; an app or plugin
 * step in this app. The first step that fails or is cancelled stops the rest.
 *
 * @param macroId - The macro's id, `user.<key>`.
 * @param commandContext - The context to run in; the current one when omitted.
 * @returns Whether every step ran.
 */
export async function runMacro(
  macroId: string,
  commandContext: CommandContextInput = currentCommandContext(),
): Promise<boolean> {
  let macros: AccountMacro[];
  let stepCommands: CommandDefinition[];
  try {
    [macros, stepCommands] = await Promise.all([fetchAccountMacros(), fetchMacroStepCommands()]);
  } catch (err) {
    toast.error(`Your macros could not be read: ${graphqlErrorMessage(err, "unknown error")}`);
    return false;
  }
  const macro = macros.find((candidate) => candidate.id === macroId);
  if (!macro) {
    toast.error("That macro is not one of yours");
    return false;
  }
  const title = macro.title || macro.id;
  if (!macro.isEnabled) {
    toast.info(`Macro "${title}" is turned off`);
    return false;
  }
  const registry = macroRegistry([...stepCommands, ...LOCAL_COMMANDS], macros);

  let steps: PlannedStep[];
  try {
    steps = plannedSteps(macro, registry);
  } catch (err) {
    if (!(err instanceof MacroRefused)) throw err;
    toast.error(`Macro "${title}" can't run: ${err.message}`);
    return false;
  }

  const commands = steps.map((step) => registry.command(step.commandId));
  const titles = steps.map((step, i) => commands[i]?.title || stepTitle(step.commandId, registry));

  const fields = steps.flatMap((step, i) =>
    step.ask.map((name) => askedField(i, name, commands[i], titles[i])),
  );
  let asked: Record<string, unknown> = {};
  if (fields.length > 0) {
    const values = await useCommandArgumentsStore.getState().ask({
      title,
      arguments: fields,
      workspaceId: commandContext.workspaceId,
    });
    if (values === null) return false;
    asked = values;
  }

  const executeStep = (input: Parameters<typeof executeCommandAt>[0]) =>
    executeCommandAt({ ...input, initiator: CommandInitiator.MACRO });

  for (const [i, step] of steps.entries()) {
    const command = commands[i];
    if (!command) {
      stepFailed(
        i,
        titles[i],
        parsePluginCommandId(step.commandId)
          ? "its plugin isn't installed on this device"
          : "this command isn't available here",
      );
      return false;
    }
    const args = { ...step.args, ...askedValues(i, asked) };
    let result: CommandResult | null;
    try {
      result = await dispatchCommand(command, executeStep, {
        args,
        commandContext,
        typedArgs: true,
        askForArguments: false,
      });
    } catch (err) {
      noteTimedOutError(commandContext.workspaceId, err);
      stepFailed(i, titles[i], graphqlErrorMessage(err, "unknown error"));
      return false;
    }
    if (result?.status === "ERROR") {
      stepFailed(i, titles[i], result.message || "unknown error");
      return false;
    }
  }
  toast.success(`Macro "${title}" ran`);
  return true;
}
