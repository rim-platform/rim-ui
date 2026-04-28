import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { usePluginList } from "./usePluginList";
import type { KeybindContext } from "../../commands/types";

export interface PluginSuggestedKeybind {
  pluginId: string;
  pluginName: string;
  commandId: string;
  commandTitle: string;
  keystroke: string;
  context: KeybindContext;
}

interface RustSuggestedKeybind {
  plugin_id: string;
  command_id: string;
  keystroke: string;
  context: string;
}

async function fetchSuggestedKeybinds(): Promise<RustSuggestedKeybind[]> {
  const result = await safeInvoke<RustSuggestedKeybind[]>("plugin_suggested_keybinds", {});
  if (!result.ok) {
    // ipc_unavailable = web mode / dev without Tauri; other errors = empty fallback
    return [];
  }
  return result.value;
}

export function usePluginSuggestedKeybindsFromRust() {
  const { capabilities } = useRuntime();

  return useQuery({
    queryKey: [...queryKeys.plugins(), "suggestedKeybinds"] as const,
    enabled: capabilities.pluginHost,
    queryFn: fetchSuggestedKeybinds,
  });
}

/**
 * Merges suggested keybinds from Rust invoke AND from plugin manifest `suggested_keybind` fields.
 * Returns a unified list of plugin keybind suggestions.
 */
export function usePluginSuggestedKeybinds(): PluginSuggestedKeybind[] {
  const { data: plugins } = usePluginList();
  const { data: rustKeybinds } = usePluginSuggestedKeybindsFromRust();

  return useMemo(() => {
    const suggestions: PluginSuggestedKeybind[] = [];

    // From Rust invoke (primary source — qualified keybind suggestions from manifest)
    if (rustKeybinds && plugins) {
      for (const rk of rustKeybinds) {
        const plugin = plugins.find((p) => p.plugin_id === rk.plugin_id);
        if (!plugin || !plugin.enabled) continue;
        suggestions.push({
          pluginId: rk.plugin_id,
          pluginName: plugin.display_name,
          commandId: `plugin.${rk.plugin_id}.${rk.command_id}`,
          commandTitle: rk.command_id,
          keystroke: rk.keystroke,
          context: (rk.context as KeybindContext) || "GLOBAL",
        });
      }
    }

    return suggestions;
  }, [plugins, rustKeybinds]);
}
