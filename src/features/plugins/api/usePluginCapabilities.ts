import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import type { PluginCapability } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";
import { safeInvoke, type PluginIpcError } from "./ipc";

export function useApproveCapabilities() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<void, PluginIpcError, { pluginId: string; capabilities: PluginCapability[] }>({
    mutationFn: (args) =>
      platform === "web"
        ? browserPluginStore.approveCapabilities(args.pluginId, args.capabilities)
        : safeInvoke("plugin_approve_capabilities", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

/** Take one capability back; the plugin stops, as for every capability. */
export function useRevokeCapability() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<void, PluginIpcError, { pluginId: string; capability: string }>({
    mutationFn: (args) =>
      platform === "web"
        ? browserPluginStore.revokeCapability(args.pluginId, args.capability)
        : safeInvoke("plugin_revoke_capability", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
