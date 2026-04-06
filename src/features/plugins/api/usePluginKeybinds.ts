import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
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
  try {
    return await invoke<RustSuggestedKeybind[]>("plugin_suggested_keybinds");
  } catch {
    // Tauri command not yet available — return empty for development
    return [];
  }
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

    // From Rust invoke
    if (rustKeybinds && plugins) {
      for (const rk of rustKeybinds) {
        const plugin = plugins.find((p) => p.manifest.id === rk.plugin_id);
        if (!plugin || !plugin.enabled) continue;
        const cmd = plugin.manifest.commands?.find((c) => c.id === rk.command_id);
        suggestions.push({
          pluginId: rk.plugin_id,
          pluginName: plugin.manifest.name,
          commandId: `plugin.${rk.plugin_id}.${rk.command_id}`,
          commandTitle: cmd?.title ?? rk.command_id,
          keystroke: rk.keystroke,
          context: (rk.context as KeybindContext) || "GLOBAL",
        });
      }
    }

    // From manifest suggested_keybind fields (fallback if Rust invoke returns nothing)
    if (plugins && suggestions.length === 0) {
      for (const plugin of plugins) {
        if (!plugin.enabled || plugin.health !== "running") continue;
        for (const cmd of plugin.manifest.commands ?? []) {
          if (cmd.suggested_keybind) {
            suggestions.push({
              pluginId: plugin.manifest.id,
              pluginName: plugin.manifest.name,
              commandId: `plugin.${plugin.manifest.id}.${cmd.id}`,
              commandTitle: cmd.title,
              keystroke: cmd.suggested_keybind,
              context: "GLOBAL",
            });
          }
        }
      }
    }

    return suggestions;
  }, [plugins, rustKeybinds]);
}
