import { create } from "zustand";

/** What a command asks a Settings page to open once it shows. */
export type SettingsIntent =
  | { kind: "bot-create" }
  | { kind: "bot-edit"; botUserId: string }
  | { kind: "webhook-create" }
  | { kind: "block-principal"; principalId: string }
  | {
      kind: "plugin";
      action: "install" | "toggle" | "update" | "uninstall";
      pluginId?: string;
      /** For `install`: start installing from a folder or a git URL rather than offer the ways. */
      source?: PluginInstallSource;
    };

/** A way to install a plugin that the Install Plugin command can start. */
export type PluginInstallSource = "folder" | "git";

interface SettingsIntentState {
  intent: SettingsIntent | null;
  set: (intent: SettingsIntent) => void;
  clear: () => void;
}

/** The pending request a command made of a Settings page, until the page takes it. */
export const useSettingsIntentStore = create<SettingsIntentState>((set) => ({
  intent: null,
  set: (intent) => set({ intent }),
  clear: () => set({ intent: null }),
}));
