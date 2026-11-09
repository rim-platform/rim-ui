import { useCallback, useMemo } from "react";

import { commandOfferedHere } from "../../agent/agentAvailability";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { argumentsNoSurfaceSupplies, runsWithoutArguments } from "../runtime/commandRunnable";
import { LOCAL_COMMANDS, withClientLabel } from "../runtime/localCommands";
import type { CommandDefinition } from "../types";
import { useCommands } from "./useCommands";

/** The commands a person may bind to a key here, as the keybind picker lists them. */
export interface KeybindableCommands {
  /** The server's keybind-capable commands offered in this app. */
  builtIn: CommandDefinition[];
  /** This app's own and the plugins' keybind-capable commands, bound on this device. */
  device: CommandDefinition[];
  /** Both lists, the server's first. */
  all: CommandDefinition[];
  /** The server's keybind-capable commands offered here that are left out for their arguments. */
  unrunnable: CommandDefinition[];
  /**
   * Whether a keybind or quick action to `commandId` with `presetArgs` lacks a required argument
   * nothing supplies; such a command is left out of the lists above.
   */
  needsArguments: (commandId: string, presetArgs?: unknown) => boolean;
}

function asArgs(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The keybind-capable commands offered in this app that a key or a quick action can run: the
 * server's, this app's own and the installed plugins', with the titles this app shows for them.
 * A command with a required argument that neither the context nor a prompt supplies is left out.
 */
export function useKeybindableCommands(): KeybindableCommands {
  const { data: commands } = useCommands("KEYBIND_PICKER");
  const pluginCommands = usePluginCommands();
  const offered = useMemo(
    () =>
      commands
        ?.filter((cmd) => cmd.keybindCapable && commandOfferedHere(cmd.id))
        .map(withClientLabel) ?? [],
    [commands],
  );
  const builtIn = useMemo(() => offered.filter(runsWithoutArguments), [offered]);
  const unrunnable = useMemo(() => offered.filter((cmd) => !runsWithoutArguments(cmd)), [offered]);
  const device = useMemo(() => {
    const serverIds = new Set(offered.map((cmd) => cmd.id));
    return [
      ...LOCAL_COMMANDS.filter((cmd) => cmd.keybindCapable && !serverIds.has(cmd.id)),
      ...pluginCommands.filter((cmd) => cmd.keybindCapable),
    ].filter((cmd) => commandOfferedHere(cmd.id));
  }, [offered, pluginCommands]);
  const all = useMemo(() => [...builtIn, ...device], [builtIn, device]);
  const needsArguments = useCallback(
    (commandId: string, presetArgs?: unknown) => {
      const command = offered.find((cmd) => cmd.id === commandId);
      return (
        command !== undefined && argumentsNoSurfaceSupplies(command, asArgs(presetArgs)).length > 0
      );
    },
    [offered],
  );
  return { builtIn, device, all, unrunnable, needsArguments };
}
