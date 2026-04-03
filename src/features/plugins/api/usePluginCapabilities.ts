import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { queryKeys } from "../../../core/query/keys";
import type { PluginCapability } from "../types";

async function safeInvoke(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch {
    // Tauri command not yet available — no-op for development
  }
}

export function useApproveCapabilities() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: { pluginId: string; capabilities: PluginCapability[] }) =>
      safeInvoke("plugin_approve_capabilities", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function useRevokeCapabilities() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: { pluginId: string; capabilities: PluginCapability[] }) =>
      safeInvoke("plugin_revoke_capabilities", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
