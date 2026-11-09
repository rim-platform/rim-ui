import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { safeInvoke, type PluginIpcError } from "./ipc";

// The plugin IPC error under the name of this module's commands.
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

/**
 * Takes back every AI-callable command of a plugin the person approved, refreshes the plugin
 * list and names in a toast any command that could not be revoked. A plugin's row and the
 * Revoke a Plugin's AI Access command both run it.
 *
 * @returns Whether every command was revoked.
 */
export async function revokePluginAiAccess(
  qc: QueryClient,
  { pluginId, commandIds }: { pluginId: string; commandIds: string[] },
): Promise<boolean> {
  const results = await Promise.allSettled(
    commandIds.map((commandId) => safeInvoke("plugin_revoke_ai_consent", { pluginId, commandId })),
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
  void qc.invalidateQueries({ queryKey: queryKeys.plugins() });
  if (failed.length > 0) {
    toast.error("Some commands could not be revoked", {
      description: `Failed: ${failed.join(", ")}`,
    });
  }
  return failed.length === 0;
}

/** {@link revokePluginAiAccess} with its pending state, for a control that shows it. */
export function useRevokeAllAiConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { pluginId: string; commandIds: string[] }) =>
      revokePluginAiAccess(qc, args),
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
