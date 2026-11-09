// The commands a plugin may run, in the store that keeps its approvals: the Rust host's
// state on the desktop, the browser's install records on the web.

import { detectPlatform, type AppPlatform } from "../../../core/runtime/runtime";
import { safeInvokeOrThrow } from "../../../core/tauri/safeInvoke";
import type { PluginCommandRunOutcome } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";

/**
 * Grant `pluginId` running each of `commandIds`, which its manifest's `runs_commands` must
 * list. Rejects when one is not listed or no plugin may run it.
 */
export async function grantPluginCommands(
  pluginId: string,
  commandIds: readonly string[],
  platform: AppPlatform = detectPlatform(),
): Promise<void> {
  if (commandIds.length === 0) return;
  if (platform === "web") {
    await browserPluginStore.grantCommands(pluginId, [...commandIds]);
    return;
  }
  await safeInvokeOrThrow<void>(
    "plugin_grant_commands",
    { pluginId, commandIds: [...commandIds] },
    { throwOnUnavailable: true },
  );
}

/** Take back `pluginId`'s grant to run `commandId`. The plugin keeps running. */
export async function revokePluginCommand(
  pluginId: string,
  commandId: string,
  platform: AppPlatform = detectPlatform(),
): Promise<void> {
  if (platform === "web") {
    await browserPluginStore.revokeCommand(pluginId, commandId);
    return;
  }
  await safeInvokeOrThrow<void>(
    "plugin_revoke_command",
    { pluginId, commandId },
    { throwOnUnavailable: true },
  );
}

/** The name an id out of shape is recorded under, so the audit never holds a plugin's junk. */
const INVALID_COMMAND_ID = "invalid-command-id";

/** Whether `commandId` can be recorded as it is: 1 to 256 printable ASCII characters. */
function recordable(commandId: string): boolean {
  return commandId.length > 0 && commandId.length <= 256 && /^[\x21-\x7e]+$/.test(commandId);
}

/**
 * Record in `pluginId`'s audit that it asked the app to run `commandId`, and how the run
 * ended. A failure to record is returned, never thrown: the run's answer does not wait on it.
 *
 * @param code - Why a refused run was refused.
 * @returns The error that kept it from being recorded, or `null`.
 */
export async function recordPluginCommandRun(
  pluginId: string,
  commandId: string,
  outcome: PluginCommandRunOutcome,
  code?: string,
  platform: AppPlatform = detectPlatform(),
): Promise<unknown> {
  const id = recordable(commandId) ? commandId : INVALID_COMMAND_ID;
  try {
    if (platform === "web") {
      await browserPluginStore.recordCommandRun(pluginId, id, outcome, code);
    } else {
      await safeInvokeOrThrow<void>("plugin_record_command_run", {
        pluginId,
        commandId: id,
        outcome,
        code: code ?? null,
      });
    }
    return null;
  } catch (error) {
    return error;
  }
}
