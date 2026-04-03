import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import type { PluginInfo } from "../types";

const MOCK_PLUGINS: PluginInfo[] = [
  {
    manifest: {
      id: "rim-code-highlight",
      name: "Code Highlight",
      version: "1.0.0",
      description: "Syntax highlighting for code blocks in messages",
      author: "RIM Team",
      trust_level: "official",
      capabilities: ["clipboard"],
      commands: [
        {
          id: "highlight_selection",
          title: "Highlight Code",
          description: "Apply syntax highlighting to selected code block",
          context_menu_action: true,
          context_types: ["message"],
          suggested_keybind: "Ctrl+Shift+H",
        },
      ],
      panels: [
        {
          id: "main",
          title: "Code Highlight",
          slot: "tool_panel",
        },
      ],
    },
    enabled: true,
    approved_capabilities: ["clipboard"],
    health: "running",
  },
  {
    manifest: {
      id: "community-emoji-pack",
      name: "Emoji Pack",
      version: "0.3.2",
      description: "Extended emoji collection with custom reactions",
      author: "communitydev",
      trust_level: "community",
      capabilities: ["network"],
    },
    enabled: false,
    approved_capabilities: [],
    health: "stopped",
  },
];

async function fetchPluginList(): Promise<PluginInfo[]> {
  try {
    return await invoke<PluginInfo[]>("plugin_list");
  } catch {
    // Tauri command not yet available — return mock data for development
    return MOCK_PLUGINS;
  }
}

export function usePluginList() {
  const { capabilities } = useRuntime();

  return useQuery({
    queryKey: queryKeys.plugins(),
    enabled: capabilities.pluginHost,
    queryFn: fetchPluginList,
  });
}
