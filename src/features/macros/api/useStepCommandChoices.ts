import { useMemo } from "react";

import { AGENT_MANAGEMENT_COMMAND_IDS } from "../../commands/runtime/appCommands/agentCommandIds";
import { withClientLabel } from "../../commands/runtime/localCommands";
import type { CommandDefinition } from "../../commands/types";
import { EDIT_HOME_COMMAND_ID } from "../../home/editHome";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { isMacroId } from "../runtime/macroCommands";
import { useMacroStepCommands, type MacroStepCommand } from "./useAccountMacros";

/** The commands a macro step may be set to run, and every one known here by id. */
export interface StepCommandChoices {
  /** What the step picker offers: built-ins, app commands and installed plugins' commands. */
  offered: CommandDefinition[];
  /** A step's command by id, with whether the AI agent may run it; `undefined` when unknown. */
  command: (commandId: string) => (CommandDefinition & { aiCallable?: boolean }) | undefined;
  /** Whether the home server's list of step commands has loaded. */
  loaded: boolean;
}

/** Whether the step picker leaves `commandId` out: macros, agent management and Edit Home. */
function leftOut(commandId: string): boolean {
  return (
    isMacroId(commandId) ||
    AGENT_MANAGEMENT_COMMAND_IDS.has(commandId) ||
    commandId === EDIT_HOME_COMMAND_ID
  );
}

/**
 * The commands a macro step may run: every built-in and app command the home server accepts as
 * a step, with the titles this app shows, and the installed plugins' commands. Macros, the
 * commands that manage agents and Edit Home are not offered.
 */
export function useStepCommandChoices(): StepCommandChoices {
  const { data: stepCommands, isSuccess } = useMacroStepCommands();
  const pluginCommands = usePluginCommands();
  return useMemo(() => {
    const byId = new Map<string, CommandDefinition & { aiCallable?: boolean }>();
    for (const command of stepCommands ?? ([] as MacroStepCommand[])) {
      if (!byId.has(command.id)) byId.set(command.id, withClientLabel(command));
    }
    for (const command of pluginCommands) {
      if (command.id.startsWith("plugin.") && !byId.has(command.id)) byId.set(command.id, command);
    }
    const offered = [...byId.values()].filter((command) => !leftOut(command.id));
    return { offered, command: (id) => byId.get(id), loaded: isSuccess };
  }, [stepCommands, pluginCommands, isSuccess]);
}
