import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { SENSITIVITY_RANK } from "../../commands/runtime/humanConfirmation";
import { BUILT_IN_COMMAND_TITLES, withClientLabel } from "../../commands/runtime/localCommands";
import type { CommandDefinition } from "../../commands/types";
import { findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import type { AccountMacro, AccountMacroStep } from "../api/useAccountMacros";

/** The category every macro is listed under. */
export const MACRO_CATEGORY = "Macro";

const MACRO_PREFIX = "user.";

/** The longest key a macro made from its title gets, before any `-2` that keeps it unique. */
const MAX_KEY_LENGTH = 64;

/** Why "The assistant and agents can run this" cannot be turned on for a macro whose steps do not allow it. */
export const AGENT_OPTION_BLOCKER =
  "Only commands the assistant and agents may run, run on RIM's server, with every argument fixed";

/** Whether `commandId` names one of the person's macros (`user.<key>`). */
export function isMacroId(commandId: string): boolean {
  return commandId.startsWith(MACRO_PREFIX);
}

/** What a macro's steps are looked up in: the commands steps may name, and the person's macros. */
export interface MacroRegistry {
  /** The command a step names, with this app's title for it, or `undefined` when unknown here. */
  command: (commandId: string) => CommandDefinition | undefined;
  /** One of the person's macros, by id. */
  macro: (macroId: string) => AccountMacro | undefined;
}

/** The command of a plugin step, from the installed plugins, or `undefined` when not installed. */
export function pluginStepCommand(commandId: string): CommandDefinition | undefined {
  if (!commandId.startsWith("plugin.")) return undefined;
  const info = findPluginCommand(commandId);
  if (!info) return undefined;
  return {
    id: commandId,
    title: info.title,
    description: info.description,
    category: info.pluginName,
    sourceKind: "PLUGIN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: info.required_context ?? [],
    requiredCapabilities: [],
    visibleInPalette: false,
    visibleInContextMenus: false,
    keybindCapable: info.keybind_capable,
    dangerous: info.dangerous,
  };
}

/**
 * A registry over `commands`, the installed plugins' commands and `macros`, each command with the
 * title this app shows for it.
 *
 * @param commands - The commands steps may name; the first of an id wins.
 * @param macros - The person's macros.
 */
export function macroRegistry(
  commands: readonly CommandDefinition[],
  macros: readonly AccountMacro[],
): MacroRegistry {
  const byId = new Map<string, CommandDefinition>();
  for (const command of commands) {
    if (!byId.has(command.id)) byId.set(command.id, withClientLabel(command));
  }
  const macrosById = new Map(macros.map((macro) => [macro.id, macro]));
  return {
    command: (id) => byId.get(id) ?? pluginStepCommand(id),
    macro: (id) => macrosById.get(id),
  };
}

/**
 * What a step is called: its macro's title for another macro, its command's title, the title
 * this app knows for a built-in, or its id when none is known here.
 */
export function stepTitle(commandId: string, registry: MacroRegistry): string {
  if (isMacroId(commandId)) return registry.macro(commandId)?.title || commandId;
  return (
    registry.command(commandId)?.title ||
    (Object.prototype.hasOwnProperty.call(BUILT_IN_COMMAND_TITLES, commandId)
      ? BUILT_IN_COMMAND_TITLES[commandId]
      : commandId)
  );
}

/** What a macro's steps add up to. */
interface StepTotals {
  requiredContext: Set<string>;
  requiredCapabilities: Set<string>;
  keybindCapable: boolean;
  dangerous: boolean;
  sensitivity: CommandSensitivity | undefined;
}

function addStepsOf(
  macro: AccountMacro,
  registry: MacroRegistry,
  totals: StepTotals,
  open: Set<string>,
): void {
  open.add(macro.id);
  for (const step of macro.steps) {
    if (isMacroId(step.commandId)) {
      const nested = registry.macro(step.commandId);
      if (nested && !open.has(nested.id)) addStepsOf(nested, registry, totals, open);
      continue;
    }
    // A plugin step, or one not known here, counts as keybind-capable and safe; the plugin's own
    // rules apply when it runs.
    if (step.commandId.startsWith("plugin.")) continue;
    const command = registry.command(step.commandId);
    if (!command) continue;
    for (const context of command.requiredContext) totals.requiredContext.add(context);
    for (const capability of command.requiredCapabilities) {
      totals.requiredCapabilities.add(capability);
    }
    totals.keybindCapable &&= command.keybindCapable;
    totals.dangerous ||= command.dangerous;
    const sensitivity = command.sensitivity;
    if (
      sensitivity &&
      (!totals.sensitivity || SENSITIVITY_RANK[sensitivity] > SENSITIVITY_RANK[totals.sensitivity])
    ) {
      totals.sensitivity = sensitivity;
    }
  }
  open.delete(macro.id);
}

/**
 * A macro as a command the palette, keybinds, quick boxes and the message box list: in the
 * `Macro` category, the person's own (`USER`), run by this app step by step. It needs the
 * context and capabilities of every step, a key can run it when every step's command can, it
 * is dangerous when a step is, and its sensitivity is the strictest of its steps'.
 *
 * @param saved - The macro as the home server keeps it.
 * @param registry - Where its steps' commands and nested macros are looked up.
 * @returns The macro's command, with no arguments of its own.
 */
export function macroDefinition(saved: AccountMacro, registry: MacroRegistry): CommandDefinition {
  const totals: StepTotals = {
    requiredContext: new Set(),
    requiredCapabilities: new Set(),
    keybindCapable: true,
    dangerous: false,
    sensitivity: undefined,
  };
  addStepsOf(saved, registry, totals, new Set());
  return {
    id: saved.id,
    title: saved.title || saved.id,
    description: saved.description,
    category: MACRO_CATEGORY,
    sourceKind: "USER",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [...totals.requiredContext],
    requiredCapabilities: [...totals.requiredCapabilities],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: totals.keybindCapable,
    dangerous: totals.dangerous,
    sensitivity: totals.sensitivity ?? CommandSensitivity.SAFE,
  };
}

/**
 * `server` with the macros it lists replaced by `macros`, so macros read from the home server
 * show in every workspace. Unchanged when `macros` is `null` (the home server keeps no macros
 * of its own) or `server` is not loaded yet.
 */
export function withMacroCommands(
  server: readonly CommandDefinition[] | undefined,
  macros: readonly CommandDefinition[] | null,
): CommandDefinition[] | undefined {
  if (!server) return undefined;
  if (macros === null) return [...server];
  return [...server.filter((command) => !isMacroId(command.id)), ...macros];
}

/**
 * The key of a new macro, made from its title: lowercase letters and numbers, words joined by
 * `-`, accents dropped, at most 64 characters, `macro` when nothing is left. A key `existing`
 * already holds gets `-2`, `-3` and on.
 *
 * @param title - The macro's title.
 * @param existing - The ids (`user.<key>`) of the person's macros.
 * @returns The key, without `user.`.
 */
export function macroKeyFromTitle(title: string, existing: Iterable<string>): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_KEY_LENGTH)
      .replace(/-+$/, "") || "macro";
  const taken = new Set(existing);
  if (!taken.has(`${MACRO_PREFIX}${slug}`)) return slug;
  for (let n = 2; ; n += 1) {
    const key = `${slug}-${n}`;
    if (!taken.has(`${MACRO_PREFIX}${key}`)) return key;
  }
}

/**
 * Why the AI agent may not run a macro with `steps`, or `null` when it may: every step is a
 * built-in the AI agent may run, which RIM's server runs, with every argument fixed.
 *
 * @param steps - The macro's steps.
 * @param commands - The commands steps may name, by id; built-ins carry `aiCallable`.
 */
export function agentOptionBlocker(
  steps: readonly Pick<AccountMacroStep, "commandId" | "ask">[],
  commands: (commandId: string) => (CommandDefinition & { aiCallable?: boolean }) | undefined,
): string | null {
  if (steps.length === 0) return AGENT_OPTION_BLOCKER;
  const allowed = steps.every((step) => {
    if (step.ask.length > 0) return false;
    const command = commands(step.commandId);
    return (
      command !== undefined &&
      command.sourceKind === "BUILT_IN" &&
      command.executionTarget === "BACKEND" &&
      command.aiCallable === true
    );
  });
  return allowed ? null : AGENT_OPTION_BLOCKER;
}
