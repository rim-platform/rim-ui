import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import type { CommandResult } from "../../commands/types";
import type { PluginCommandInfo, PluginInfo } from "../types";

/** A plugin command with the name of the plugin that declares it. */
export interface FoundPluginCommand extends PluginCommandInfo {
  pluginName: string;
}

/**
 * Look up `plugin.<plugin_id>.<command>` in the cached plugin list. Plugin ids
 * contain dots, so the id is matched whole rather than split.
 */
export function findPluginCommand(qualifiedId: string): FoundPluginCommand | null {
  const plugins = queryClient.getQueryData<PluginInfo[]>(queryKeys.plugins()) ?? [];
  for (const plugin of plugins) {
    const command = plugin.commands?.find((c) => c.qualified_id === qualifiedId);
    if (command) return { ...command, pluginName: plugin.display_name };
  }
  return null;
}

/** Payload of a command result when the user declined to confirm the command. */
export const CANCELLED_PAYLOAD = Object.freeze({ cancelled: true });

/** True for the result of a dangerous command the user chose not to run. */
export function isCancelledResult(result: { payload: unknown } | null | undefined): boolean {
  return result?.payload === CANCELLED_PAYLOAD;
}

/**
 * Tell the user how a plugin command they ran from the palette or a keybind
 * went, in the plugin's own words. Nothing is shown when they declined to
 * confirm it: they already know.
 */
export function toastPluginCommandResult(title: string, result: CommandResult | null): void {
  if (isCancelledResult(result)) return;
  if (result === null || result.status === "ERROR") {
    toast.error(`${title}: ${result?.message || "Command failed"}`);
  } else {
    toast.success(result.message ? `${title}: ${result.message}` : title);
  }
}
