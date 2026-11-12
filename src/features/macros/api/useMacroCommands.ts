import { useMemo } from "react";

import { useCommands } from "../../commands/api/useCommands";
import { LOCAL_COMMANDS } from "../../commands/runtime/localCommands";
import type { CommandDefinition, CommandSurface } from "../../commands/types";
import {
  macroDefinition,
  macroRegistry,
  withMacroCommands,
  type MacroRegistry,
} from "../runtime/macroCommands";
import { useAccountMacros, useAccountMacrosOn, useMacroStepCommands } from "./useAccountMacros";

const NO_MACROS: readonly CommandDefinition[] = [];

/**
 * Where the person's macros' steps are looked up: the commands steps may name, this app's own,
 * the installed plugins' and the person's macros.
 *
 * @returns The registry, or `null` while the home server keeps no macros of its own.
 */
export function useMacroRegistry(): MacroRegistry | null {
  const on = useAccountMacrosOn();
  const { data: macros } = useAccountMacros();
  const { data: stepCommands } = useMacroStepCommands();
  return useMemo(
    () => (on ? macroRegistry([...(stepCommands ?? []), ...LOCAL_COMMANDS], macros ?? []) : null),
    [on, macros, stepCommands],
  );
}

/**
 * The person's enabled macros as commands, read from the home server, for every workspace.
 *
 * @returns The macros (empty while they load), or `null` while the home server keeps no macros
 *   of its own and lists them among its commands instead.
 */
export function useMacroCommands(): readonly CommandDefinition[] | null {
  const registry = useMacroRegistry();
  const { data: macros } = useAccountMacros();
  return useMemo(() => {
    if (!registry) return null;
    if (!macros) return NO_MACROS;
    return macros
      .filter((macro) => macro.isEnabled)
      .map((macro) => macroDefinition(macro, registry));
  }, [registry, macros]);
}

/**
 * The commands `surface` lists in the open workspace, as {@link useCommands} reads them, with
 * the macros there replaced by the person's macros from the home server when it keeps them.
 */
export function useCommandsWithMacros(surface?: CommandSurface) {
  const { data: server, isLoading, isPending } = useCommands(surface);
  const macros = useMacroCommands();
  const data = useMemo(() => withMacroCommands(server, macros), [server, macros]);
  return { data, isLoading, isPending };
}
