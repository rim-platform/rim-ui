import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import type { PluginInfo } from "../types";

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
    health: "stopped",
  },
];

export async function fetchPluginList(): Promise<PluginInfo[]> {
  const result = await safeInvoke<PluginInfo[]>("plugin_list", {});
  if (!result.ok) {
    if (result.error.kind === "ipc_unavailable") {
      // Web mode or dev without Tauri — return mock data
      return MOCK_PLUGINS;
    }
    // Unexpected backend error — return empty rather than crashing the UI
    return [];
  }
  return result.value;
}

export function usePluginList() {
  const { capabilities } = useRuntime();

  return useQuery({
    queryKey: queryKeys.plugins(),
    enabled: capabilities.pluginHost,
    queryFn: fetchPluginList,
  });
}
