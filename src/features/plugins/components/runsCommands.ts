import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { useCommands } from "../../commands/api/useCommands";
import { LOCAL_COMMANDS, withClientLabel } from "../../commands/runtime/localCommands";
import type { CommandDefinition } from "../../commands/types";
import { unrunnableByPlugins } from "../../../../sdk/plugin-sdk/src/manifestRules";

/** How a plugin may run one id its manifest lists in `runs_commands`. */
export type RunsCommandKind =
  /** The person may grant it; it runs at once. */
  | "runs"
  /** The person may grant it; it asks them each time it changes something. */
  | "asks"
  /** No plugin may run it. */
  | "never"
  /** Neither the workspace nor this app offers it. */
  | "unavailable";

/** One id of a manifest's `runs_commands`, as the permission prompt lists it. */
export interface RunsCommandRow {
  id: string;
  /** The command's title, or its id when it is not offered here. */
  title: string;
  category: string | null;
  kind: RunsCommandKind;
}

/**
 * How each of `ids` reads in the prompt: an app command by whether plugins may run it, a
 * built-in from `serverCommands` by its danger and sensitivity, and anything else as not
 * offered here. The rules are the command runner's.
 *
 * @param serverCommands - The built-ins the workspace lists now.
 */
export function runsCommandRows(
  ids: readonly string[],
  serverCommands: readonly CommandDefinition[],
): RunsCommandRow[] {
  return ids.map((id) => {
    const app = LOCAL_COMMANDS.find((c) => c.id === id);
    const listed = app ? undefined : serverCommands.find((c) => c.id === id);
    const command = app ?? listed;
    const label = command ? withClientLabel(command) : null;
    const row = (kind: RunsCommandKind): RunsCommandRow => ({
      id,
      title: label?.title || id,
      category: command?.category || null,
      kind,
    });
    if (unrunnableByPlugins(id) !== null) return row("never");
    if (app) return row(app.pluginRunnable ? "runs" : "never");
    if (!listed) return row("unavailable");
    if (
      listed.sourceKind !== "BUILT_IN" ||
      listed.dangerous ||
      listed.sensitivity === CommandSensitivity.RESTRICTED
    ) {
      return row("never");
    }
    if (listed.executionTarget === "DESKTOP_LOCAL") {
      return row(listed.sensitivity === CommandSensitivity.SAFE ? "runs" : "never");
    }
    return row(listed.sensitivity === CommandSensitivity.MUTATING ? "asks" : "runs");
  });
}

/** {@link runsCommandRows} against the built-ins the open workspace lists. */
export function useRunsCommandRows(ids: readonly string[]): RunsCommandRow[] {
  const palette = useCommands("PALETTE");
  const keybinds = useCommands("KEYBIND_PICKER");
  return runsCommandRows(ids, [...(palette.data ?? []), ...(keybinds.data ?? [])]);
}

/** What the prompt says of a row besides its title. */
export function runsCommandNote(row: RunsCommandRow): string | null {
  switch (row.kind) {
    case "asks":
      return "asks you each time";
    case "never":
      return "Plugins can't run this";
    case "unavailable":
      return "Not available here";
    case "runs":
      return null;
  }
}
