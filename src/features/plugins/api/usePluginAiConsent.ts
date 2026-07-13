import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { logger } from "../../../core/logger";
import { safeInvoke, type PluginIpcError } from "./ipc";

// Re-exported for consumers that imported this type before the shared ipc shim existed.
export type { PluginIpcError as PluginCommandError };

export function useApproveAiCommands() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, { pluginId: string; commandIds: string[] }>({
    mutationFn: (args) =>
      safeInvoke("plugin_approve_ai_commands", {
        pluginId: args.pluginId,
        commandIds: args.commandIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function useRevokeAiConsent() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, { pluginId: string; commandId: string }>({
    mutationFn: (args) =>
      safeInvoke("plugin_revoke_ai_consent", {
        pluginId: args.pluginId,
        commandId: args.commandId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function useRevokeAllAiConsent() {
  const qc = useQueryClient();

  return useMutation<
    { failed: string[] },
    PluginIpcError,
    { pluginId: string; commandIds: string[] }
  >({
    mutationFn: async ({ pluginId, commandIds }) => {
      const results = await Promise.allSettled(
        commandIds.map((commandId) =>
          safeInvoke("plugin_revoke_ai_consent", { pluginId, commandId }),
        ),
      );
      const failed = commandIds.filter((_, i) => {
        const result = results[i];
        if (result.status === "rejected") {
          logger.error("[RIM:Plugin] revoke failed", {
            pluginId,
            commandId: commandIds[i],
            error: result.reason,
          });
          return true;
        }
        return false;
      });
      return { failed };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

export function useRevokeAllPluginsAiConsent() {
  const qc = useQueryClient();

  return useMutation<
    { revokedCount: number; failedCount: number },
    never,
    Array<{ pluginId: string; commandIds: string[] }>
  >({
    mutationFn: async (plugins) => {
      const pairs = plugins.flatMap(({ pluginId, commandIds }) =>
        commandIds.map((commandId) => ({ pluginId, commandId })),
      );
      const results = await Promise.allSettled(
        pairs.map(({ pluginId, commandId }) =>
          safeInvoke("plugin_revoke_ai_consent", { pluginId, commandId }),
        ),
      );
      let failedCount = 0;
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          failedCount++;
          logger.error("[RIM:Plugin] revoke failed", { ...pairs[i], error: result.reason });
        }
      });
      return { revokedCount: results.length - failedCount, failedCount };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
