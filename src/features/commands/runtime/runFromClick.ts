import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import {
  COMMAND_INITIATOR_UI,
  serverHasCapability,
  spaceHasCapability,
} from "../../updater/api/serverCapabilities";
import { accountMacrosOn, fetchMacroStepCommands } from "../../macros/api/useAccountMacros";
import { executeAsPerson, fetchCommandList } from "../api/useCommands";
import type { CommandDefinition, CommandResult, CommandSurface } from "../types";
import { currentCommandContext, type CommandContextTarget } from "./commandContext";
import { dispatchCommand, hasLocalHandler, LOCAL_ACTION_PAYLOAD } from "./commandDispatcher";
import { showCommandOutcome } from "./commandOutcome";
import type { ConfirmationSubject } from "./humanConfirmation";
import { standInCommand } from "./keybindCommand";
import { isLocalCommand, LOCAL_COMMANDS, withClientLabel } from "./localCommands";
import { showCommandRefusal } from "./refusal";

/** The kind of control a click came from: a button, a menu item or a key in a list. */
export type ClickSource = "button" | "menu" | "key";

/** How {@link runCommandFromClick} runs a control's command. */
export interface ClickOptions {
  /** The kind of control; `"button"` when left out. */
  source?: ClickSource;
  /** What the control acts on, in place of the open conversation and selected message. */
  target?: CommandContextTarget;
  /** The control's own dialog was the person's confirmation. */
  confirmed?: boolean;
  /** What the confirmation dialog shows in place of the command's own title and description. */
  confirmation?: Partial<ConfirmationSubject>;
  /** The toast a success shows in place of the command's own outcome; `null` shows none. */
  successToast?: string | ((result: CommandResult) => string | null);
  /** The title a refusal shows in place of the command's title. */
  errorTitle?: string;
  /** Throws a failure as an `Error` with the server's message instead of showing it. */
  throwOnError?: boolean;
  /** Runs in place of the command when its workspace's server does not list it. */
  fallback?: () => Promise<void>;
  /**
   * The arguments were saved with the control, as a quick action's are, not typed for the
   * server: the argument form asks for any it lacks, and this app's own handler runs with them,
   * as for a keybind.
   */
  savedArgs?: boolean;
}

/** How a click's command ended. */
export type ClickOutcome =
  { ok: true; result: CommandResult } | { ok: false; cancelled: boolean; message: string };

/** The command lists of a workspace's server that a click's command is looked up in, in order. */
const HOST_SURFACES: readonly CommandSurface[] = ["KEYBIND_PICKER", "PALETTE", "CONTEXT_MENU"];

/** A command a click runs, and what is known about the server's lists of it. */
export interface ResolvedClickCommand {
  command: CommandDefinition;
  /** The server's command lists are cached and none of them has the command. */
  hostLacks: boolean;
  /** None of the server's command lists is cached, and the command is not this app's own. */
  unknown: boolean;
}

/**
 * The command a control runs in `workspaceId`, read from what is cached: the server's keybind,
 * palette or context-menu list, then the commands macro steps may name, then this app's own,
 * else a stand-in the server runs.
 */
export function resolveClickCommand(
  commandId: string,
  workspaceId: string | undefined,
): ResolvedClickCommand {
  const lists = HOST_SURFACES.map((surface) =>
    queryClient.getQueryData<CommandDefinition[]>(queryKeys.commands(surface, workspaceId)),
  ).filter((list): list is CommandDefinition[] => list !== undefined);
  const local = isLocalCommand(commandId);
  for (const list of lists) {
    const found = list.find((command) => command.id === commandId);
    if (found) return { command: withClientLabel(found), hostLacks: false, unknown: false };
  }
  const hostLacks = lists.length > 0 && !local;
  const stepCommand = queryClient
    .getQueryData<CommandDefinition[]>(queryKeys.macroStepCommands)
    ?.find((command) => command.id === commandId);
  if (stepCommand) return { command: withClientLabel(stepCommand), hostLacks, unknown: false };
  const own = LOCAL_COMMANDS.find((command) => command.id === commandId);
  if (own) return { command: withClientLabel(own), hostLacks, unknown: false };
  // This app's own commands were found above; any other id goes to the server, even one under
  // a namespace this app also uses, such as `chat.report_message`.
  const command = standInCommand(commandId, "BACKEND");
  return { command, hostLacks, unknown: lists.length === 0 };
}

/**
 * Reads the server's palette list for `workspaceId` into the cache when none of its lists is
 * there, so a click's command is looked up in it; a failed read leaves the cache as it was.
 */
async function loadHostCommands(workspaceId: string): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: queryKeys.commands("PALETTE", workspaceId),
      queryFn: () => fetchCommandList("PALETTE", { workspaceId }),
      staleTime: Infinity,
      retry: false,
    });
  } catch {
    // The stand-in runs; the server answers for a command it does not know.
  }
}

/**
 * Reads the home server's definitions of every command into the cache, which say where each
 * runs; a failed read leaves the cache as it was.
 */
async function loadStepCommands(): Promise<void> {
  try {
    await fetchMacroStepCommands();
  } catch {
    // The stand-in runs; the server answers for a command it does not know.
  }
}

/**
 * Who a click's command is recorded as started by: a menu item's `CONTEXT_MENU`, a key's
 * `KEYBIND`, and a button's `UI` when the server it runs on lists {@link COMMAND_INITIATOR_UI},
 * else none, which the server records as a palette run.
 */
async function initiatorOf(
  source: ClickSource,
  workspaceId: string | undefined,
): Promise<CommandInitiator | undefined> {
  if (source === "menu") return CommandInitiator.CONTEXT_MENU;
  if (source === "key") return CommandInitiator.KEYBIND;
  const listed = workspaceId
    ? await spaceHasCapability(workspaceId, COMMAND_INITIATOR_UI)
    : await serverHasCapability(COMMAND_INITIATOR_UI);
  return listed ? CommandInitiator.UI : undefined;
}

/** The result a click reports when its fallback ran in place of the command. */
const FALLBACK_RESULT: CommandResult = {
  status: "SUCCESS",
  message: "",
  payload: LOCAL_ACTION_PAYLOAD,
  followUpCommands: [],
};

/**
 * Runs the command of an app control (a button, a menu item, a key in a list) the way the
 * command palette runs it: the same lookup, arguments, confirmation, effects and outcome, with
 * the control's target as context and its kind as the initiator.
 *
 * @param commandId - The command the control runs.
 * @param args - Its arguments; with none given, the argument form asks for any it needs.
 * @param options - How the control runs it.
 * @returns `ok` with the result when it succeeded; otherwise whether the person cancelled it and
 *   what went wrong. With `throwOnError`, a failure that was not a cancellation throws instead.
 */
export async function runCommandFromClick(
  commandId: string,
  args?: Record<string, unknown>,
  options: ClickOptions = {},
): Promise<ClickOutcome> {
  const commandContext = currentCommandContext(options.target);
  const workspaceId = commandContext.workspaceId ?? undefined;
  const hasArgs = args !== undefined && Object.keys(args).length > 0;
  const typedArgs = hasArgs && !options.savedArgs;

  // A command this app runs itself needs no list; one the server runs is looked up there first.
  let resolved = resolveClickCommand(commandId, workspaceId);
  if (resolved.unknown && workspaceId && (hasArgs || !hasLocalHandler(commandId))) {
    await loadHostCommands(workspaceId);
    resolved = resolveClickCommand(commandId, workspaceId);
  }
  // A host that could not be read leaves a command this app also handles to the home server's
  // definitions, so a command the app runs is not sent to a server that refuses it.
  if (resolved.unknown && hasLocalHandler(commandId) && accountMacrosOn()) {
    await loadStepCommands();
    resolved = resolveClickCommand(commandId, workspaceId);
  }
  const { command } = resolved;
  const errorTitle = options.errorTitle ?? command.title;

  const failed = (err: unknown): ClickOutcome => {
    const message = graphqlErrorMessage(err, "Command failed");
    if (options.throwOnError) throw new Error(message);
    showCommandRefusal(errorTitle, err, () => void runCommandFromClick(commandId, args, options));
    return { ok: false, cancelled: false, message };
  };

  const succeeded = async (result: CommandResult): Promise<ClickOutcome> => {
    if (options.successToast === undefined) {
      await showCommandOutcome(command, result, args, commandContext);
    } else {
      const text =
        typeof options.successToast === "function"
          ? options.successToast(result)
          : options.successToast;
      if (text) toast.success(text);
    }
    return { ok: true, result };
  };

  if (resolved.hostLacks && options.fallback) {
    try {
      await options.fallback();
    } catch (err) {
      return failed(err);
    }
    return succeeded(FALLBACK_RESULT);
  }

  let initiator: Promise<CommandInitiator | undefined> | undefined;
  const execute: Parameters<typeof dispatchCommand>[1] = async (input) => {
    initiator ??= initiatorOf(options.source ?? "button", workspaceId);
    return executeAsPerson(await initiator)(input);
  };

  let result: CommandResult | null;
  try {
    result = await dispatchCommand(command, execute, {
      args,
      commandContext,
      typedArgs,
      askForArguments: !typedArgs,
      confirmedByCaller: options.confirmed,
      confirmationSubject: options.confirmation,
    });
  } catch (err) {
    return failed(err);
  }

  if (isCancelledResult(result)) return { ok: false, cancelled: true, message: "" };
  if (result === null || result.status !== "SUCCESS") {
    const message = result?.message || "Command failed";
    if (options.throwOnError) throw new Error(message);
    await showCommandOutcome({ ...command, title: errorTitle }, result, args, commandContext);
    return { ok: false, cancelled: false, message };
  }
  return succeeded(result);
}
