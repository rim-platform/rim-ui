import { create } from "zustand";

/** What a command asks a Settings page to open once it shows. */
export type SettingsIntent =
  | { kind: "bot-create" }
  | { kind: "bot-edit"; botUserId: string }
  | { kind: "block-principal"; principalId: string }
  | {
      kind: "plugin";
      action: "install" | "toggle" | "update" | "uninstall";
      pluginId?: string;
    };

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
