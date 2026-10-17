import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PluginFingerprintDismissState {
  /** Plugin id to the bundle fingerprint its changed-bundle warning was dismissed at. */
  dismissed: Record<string, string>;
  dismiss: (pluginId: string, fingerprint: string) => void;
  restore: (pluginId: string) => void;
}

/**
 * Changed-bundle warnings dismissed on this device. A dismissal holds for one
 * fingerprint only, so the warning shows again once the bundle changes again.
 */
export const usePluginFingerprintDismissStore = create<PluginFingerprintDismissState>()(
  persist(
    (set) => ({
      dismissed: {},
      dismiss: (pluginId, fingerprint) =>
        set((state) => ({ dismissed: { ...state.dismissed, [pluginId]: fingerprint } })),
      restore: (pluginId) =>
        set((state) => {
          const dismissed = { ...state.dismissed };
          delete dismissed[pluginId];
          return { dismissed };
        }),
    }),
    { name: "rim-plugin-fingerprint-dismissals", version: 1 },
  ),
);
