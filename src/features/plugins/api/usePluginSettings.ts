import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { safeInvoke, type SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { PluginSettingsError } from "../pluginSettings";
import type { PluginSettingsFormState } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";

/**
 * A desktop host failure as a {@link PluginSettingsError}, naming the setting
 * when the host refused one of its values.
 */
function settingsError(error: SafeInvokeError): PluginSettingsError {
  const data = "data" in error ? error.data : undefined;
  const key =
    typeof data === "object" && data !== null && typeof (data as { key?: unknown }).key === "string"
      ? (data as { key: string }).key
      : null;
  return new PluginSettingsError(error.message, key);
}

async function invokeSettings<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw settingsError(result.error);
  return result.value;
}

/**
 * The settings form of `pluginId`: from the Rust host on the desktop, from the
 * browser's store on the web.
 */
export function fetchPluginSettings(
  platform: AppPlatform,
  pluginId: string,
): Promise<PluginSettingsFormState> {
  if (platform === "web") return browserPluginStore.settingsGet(pluginId);
  return invokeSettings<PluginSettingsFormState>("plugin_settings_get", { pluginId });
}

/**
 * Save `changes` to `pluginId`'s settings: a value per changed key, `null`
 * clearing one.
 *
 * @throws PluginSettingsError naming the setting the host refused.
 */
export async function savePluginSettings(
  platform: AppPlatform,
  pluginId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  if (platform === "web") return browserPluginStore.settingsSave(pluginId, changes);
  await invokeSettings<null>("plugin_settings_save", { pluginId, values: changes });
}

/** Clear every saved setting of `pluginId`, secret ones included. */
export async function resetPluginSettings(platform: AppPlatform, pluginId: string): Promise<void> {
  if (platform === "web") return browserPluginStore.settingsReset(pluginId);
  await invokeSettings<null>("plugin_settings_reset", { pluginId });
}

/** The settings form state of `pluginId`, fetched again after every save and reset. */
export function usePluginSettingsState(pluginId: string) {
  const { platform } = useRuntime();
  return useQuery({
    queryKey: queryKeys.pluginSettings(pluginId),
    queryFn: () => fetchPluginSettings(platform, pluginId),
    // The form opens on the state it loads; only a save or a reset loads it again, so a
    // refetch never replaces what the user is typing, and a closed form keeps no copy.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

/**
 * Save changes to a plugin's settings: `mutate({ pluginId, changes })`. A refused
 * value fails with a {@link PluginSettingsError} naming its setting.
 */
export function usePluginSettingsSave() {
  const qc = useQueryClient();
  const { platform } = useRuntime();
  return useMutation<void, Error, { pluginId: string; changes: Record<string, unknown> }>({
    mutationFn: ({ pluginId, changes }) => savePluginSettings(platform, pluginId, changes),
    onSuccess: (_, { pluginId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.pluginSettings(pluginId) }),
  });
}

/** Reset a plugin's settings to their defaults: `mutate(pluginId)`. */
export function usePluginSettingsReset() {
  const qc = useQueryClient();
  const { platform } = useRuntime();
  return useMutation<void, Error, string>({
    mutationFn: (pluginId) => resetPluginSettings(platform, pluginId),
    onSuccess: (_, pluginId) =>
      qc.invalidateQueries({ queryKey: queryKeys.pluginSettings(pluginId) }),
  });
}
