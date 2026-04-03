import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import type { PluginCommandResult } from "../types";

interface ExecuteCommandArgs {
  pluginId: string;
  command: string;
  args?: Record<string, unknown>;
}

async function safeExecute(args: ExecuteCommandArgs): Promise<PluginCommandResult> {
  try {
    return await invoke<PluginCommandResult>("plugin_execute_command", { ...args });
  } catch {
    // Tauri command not yet available — return mock error for development
    return { status: "error", payload: "Plugin command not available" };
  }
}

export function usePluginExecuteCommand() {
  return useMutation({
    mutationFn: safeExecute,
  });
}
