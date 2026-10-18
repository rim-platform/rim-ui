import { create } from "zustand";

interface PluginSettingsDialogState {
  /** The plugin whose settings form is open over the app, or `null`. */
  pluginId: string | null;
  open: (pluginId: string) => void;
  close: () => void;
}

/**
 * The plugin settings form opened from the plugin itself (its panel header, the command
 * palette, or its panel through `rim.settings.open`), shown over whatever is open so the user
 * stays where they were.
 */
export const usePluginSettingsDialogStore = create<PluginSettingsDialogState>((set) => ({
  pluginId: null,
  open: (pluginId) => set({ pluginId }),
  close: () => set({ pluginId: null }),
}));
