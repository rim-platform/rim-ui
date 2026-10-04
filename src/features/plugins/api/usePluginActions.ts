import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { reloadCommands } from "../../commands/api/useCommands";
import { safeInvoke, type PluginIpcError } from "./ipc";
import { safeInvoke as coreSafeInvoke } from "../../../core/tauri/safeInvoke";
import type { PluginInstallResult } from "../types";

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

/**
 * Install a plugin from a local folder on disk.
 *
 * Opens a Tauri folder-picker dialog (caller is responsible for that), then calls
 * `plugin_install_from_local` with the selected path.  On success the plugin list
 * is invalidated so the UI refreshes.
 *
 * @returns TanStack mutation — `mutate(path)` where `path` is an absolute folder path.
 */
export function usePluginInstallFromLocal() {
  const qc = useQueryClient();

  return useMutation<PluginInstallResult | undefined, PluginIpcError, string>({
    mutationFn: async (path) => {
      const result = await coreSafeInvoke<PluginInstallResult>("plugin_install_from_local", {
        path,
      });
      if (!result.ok) {
        if (result.error.kind === "ipc_unavailable") return undefined;
        throw result.error;
      }
      return result.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

/**
 * Install a plugin from a git URL.
 *
 * Calls `plugin_install_from_git` with the supplied URL and optional branch.
 * On success the plugin list is invalidated so the UI refreshes.
 *
 * @returns TanStack mutation — `mutate({ url, branch? })`.
 */
export function usePluginInstallFromGit() {
  const qc = useQueryClient();

  return useMutation<
    PluginInstallResult | undefined,
    PluginIpcError,
    { url: string; branch?: string }
  >({
    mutationFn: async ({ url, branch }) => {
      const result = await coreSafeInvoke<PluginInstallResult>("plugin_install_from_git", {
        url,
        branch: branch ?? null,
      });
      if (!result.ok) {
        if (result.error.kind === "ipc_unavailable") return undefined;
        throw result.error;
      }
      return result.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

/**
 * Accept the new bundle fingerprint for a plugin whose fingerprint has changed.
 *
 * This is the "Trust new version" action in the UI.  After this call the plugin's
 * `fingerprint_changed` flag is cleared and the user can enable the plugin normally.
 *
 * @returns TanStack mutation — `mutate(pluginId)`.
 */
export function usePluginTrustFingerprint() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_trust_fingerprint", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}
