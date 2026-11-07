import { useMemo } from "react";

import { commandOfferedHere } from "../../agent/agentAvailability";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
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
}

/**
 * The keybind-capable commands offered in this app: the server's, this app's own and the
 * installed plugins', with the titles this app shows for them.
 */
export function useKeybindableCommands(): KeybindableCommands {
  const { data: commands } = useCommands("KEYBIND_PICKER");
  const pluginCommands = usePluginCommands();
  const builtIn = useMemo(
    () =>
      commands
        ?.filter((cmd) => cmd.keybindCapable && commandOfferedHere(cmd.id))
        .map(withClientLabel) ?? [],
    [commands],
  );
  const device = useMemo(() => {
    const serverIds = new Set(builtIn.map((cmd) => cmd.id));
    return [
      ...LOCAL_COMMANDS.filter((cmd) => cmd.keybindCapable && !serverIds.has(cmd.id)),
      ...pluginCommands.filter((cmd) => cmd.keybindCapable),
    ].filter((cmd) => commandOfferedHere(cmd.id));
  }, [builtIn, pluginCommands]);
  const all = useMemo(() => [...builtIn, ...device], [builtIn, device]);
  return { builtIn, device, all };
}
