import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { reloadCommands } from "../../commands/api/useCommands";
import { safeInvoke, type PluginIpcError } from "./ipc";

export function usePluginEnable() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_enable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

export function usePluginDisable() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_disable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

export function usePluginInstall() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_install", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

export function usePluginUninstall() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_uninstall", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}
