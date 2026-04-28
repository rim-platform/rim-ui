import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import type { PluginCapability } from "../types";
import { safeInvoke, type PluginIpcError } from "./ipc";

export function useApproveCapabilities() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, { pluginId: string; capabilities: PluginCapability[] }>({
    mutationFn: (args) => safeInvoke("plugin_approve_capabilities", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function useRevokeCapabilities() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, { pluginId: string; capabilities: PluginCapability[] }>({
    mutationFn: (args) => safeInvoke("plugin_revoke_capabilities", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
