import { useEffect } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useInstalledPlugins } from "../api/usePluginList";
import { runtimeKind, type PluginInfo } from "../types";
import { configureWebPluginHost } from "./webPluginEnvironment";
import { webPluginHost, type InstalledWebPlugin } from "./webPluginHost";

/** An installed web plugin as the host needs it. */
export function toInstalledWebPlugin(plugin: PluginInfo): InstalledWebPlugin {
  return {
    pluginId: plugin.plugin_id,
    displayName: plugin.display_name,
    enabled: plugin.enabled && !plugin.fingerprint_changed,
    starting: plugin.starting === true,
    approvedCapabilities: plugin.approved_capabilities,
    commands: (plugin.commands ?? []).map((c) => ({
      id: c.id,
      dangerous: c.dangerous,
      required_capabilities: c.required_capabilities ?? [],
    })),
  };
}

/**
 * Run the enabled web plugins in this page: start a frame for each, stop the
 * frames of plugins turned off or removed. On the web the list belongs to the
 * signed-in account, so signing out stops every frame and signing in starts
 * that account's.
 */
export function useWebPluginRuntime(): void {
  const { platform, capabilities } = useRuntime();
  const { data: plugins } = useInstalledPlugins();

  useEffect(() => {
    if (capabilities.webPlugins) configureWebPluginHost(platform);
  }, [capabilities.webPlugins, platform]);

  useEffect(() => {
    if (!capabilities.webPlugins || !plugins) return;
    webPluginHost.reconcile(
      plugins.filter((p) => runtimeKind(p) === "WebSandboxed").map(toInstalledWebPlugin),
    );
  }, [capabilities.webPlugins, plugins]);
}
