import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { detectPlatform, type AppPlatform } from "../../../core/runtime/runtime";
import { runtimeKind, type PluginInfo } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";
import { webPluginHost } from "../web/webPluginHost";

const MOCK_PLUGINS: PluginInfo[] = [
  {
    plugin_id: "rim-code-highlight",
    manifest_id: "rim-code-highlight",
    display_name: "Code Highlight",
    version: "1.0.0",
    description: "Syntax highlighting for code blocks in messages",
    author: "RIM Team",
    enabled: true,
    capabilities: ["chat.read", "ui.notify"],
    approved_capabilities: ["chat.read", "ui.notify"],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    health: "running",
  },
  {
    plugin_id: "community-emoji-pack",
    manifest_id: "community-emoji-pack",
    display_name: "Emoji Pack",
    version: "0.3.2",
    description: "Extended emoji collection with custom reactions",
    author: "communitydev",
    enabled: false,
    capabilities: ["network", "fs.read"],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    health: "stopped",
  },
];

/**
 * Every installed plugin: on the desktop both kinds, from the Rust host; on the
 * web the signed-in account's web plugins, from the browser's store.
 */
export async function fetchPluginList(
  platform: AppPlatform = detectPlatform(),
): Promise<PluginInfo[]> {
  if (platform === "web") return browserPluginStore.list();
  const result = await safeInvoke<PluginInfo[]>("plugin_list", {});
  if (!result.ok) {
    if (result.error.kind === "ipc_unavailable") {
      // Dev without Tauri — return mock data
      return MOCK_PLUGINS;
    }
    // Unexpected backend error — return empty rather than crashing the UI
    return [];
  }
  return result.value;
}

/** A web plugin runs in this page, so its health is the web host's, not the store's. */
export function withWebHealth(plugins: PluginInfo[]): PluginInfo[] {
  return plugins.map((plugin) => {
    if (runtimeKind(plugin) !== "WebSandboxed") return plugin;
    const status = webPluginHost.status(plugin.plugin_id);
    const health = status.health === "starting" ? "stopped" : status.health;
    return { ...plugin, health, last_error: status.error ?? null };
  });
}

let hostVersion = 0;
const subscribeHost = (listener: () => void) =>
  webPluginHost.subscribe(() => {
    hostVersion += 1;
    listener();
  });

/** The installed plugins as the store lists them, without the web host's health. */
export function useInstalledPlugins() {
  const { platform, capabilities } = useRuntime();
  return useQuery({
    queryKey: queryKeys.plugins(),
    enabled: capabilities.pluginHost || capabilities.webPlugins,
    queryFn: () => fetchPluginList(platform),
  });
}

export function usePluginList() {
  const { platform, capabilities } = useRuntime();
  const version = useSyncExternalStore(subscribeHost, () => hostVersion);
  // Re-run when a web plugin starts or stops, so its health shows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const select = useCallback((plugins: PluginInfo[]) => withWebHealth(plugins), [version]);

  return useQuery({
    queryKey: queryKeys.plugins(),
    enabled: capabilities.pluginHost || capabilities.webPlugins,
    queryFn: () => fetchPluginList(platform),
    select,
  });
}
