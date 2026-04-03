import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { queryKeys } from "../../../core/query/keys";

async function safeInvoke(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch {
    // Tauri command not yet available — no-op for development
  }
}

export function usePluginEnable() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pluginId: string) => safeInvoke("plugin_enable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function usePluginDisable() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pluginId: string) => safeInvoke("plugin_disable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function usePluginInstall() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pluginId: string) => safeInvoke("plugin_install", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function usePluginUninstall() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pluginId: string) => safeInvoke("plugin_uninstall", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
