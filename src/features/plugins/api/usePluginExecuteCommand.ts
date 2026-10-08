import { useMutation } from "@tanstack/react-query";

import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { PluginCommandResult } from "../types";

interface ExecuteCommandArgs {
  pluginId: string;
  command: string;
  args?: Record<string, unknown>;
  /** Set only after the user confirmed a command the manifest marks dangerous. */
  confirmedDangerous?: boolean;
}

async function safeExecute(args: ExecuteCommandArgs): Promise<PluginCommandResult> {
  const result = await safeInvoke<PluginCommandResult>("plugin_execute_command", { ...args });
  if (!result.ok) {
    if (result.error.kind === "ipc_unavailable") {
      // Web mode or dev without Tauri — surface as error status
      return { status: "error", payload: "Plugin command not available" };
    }
    // Backend or permission error — propagate the structured message
    return { status: "error", payload: result.error.message };
  }
  return result.value;
}

export function usePluginExecuteCommand() {
  return useMutation({
    mutationFn: safeExecute,
  });
}
