import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { LayoutPreset } from "../types/layoutPreset";
import { BUILT_IN_PRESETS } from "../types/layoutPreset";
import { useShellStore } from "./useShellStore";
import { toast } from "../../shared/toast";

interface LayoutPresetState {
  activePresetId: string | null;
  customPresets: LayoutPreset[];
  applyPreset: (id: string) => void;
  cyclePresets: () => void;
  saveCurrentAsPreset: (name: string) => void;
  deletePreset: (id: string) => void;
}

function getAllPresets(customPresets: LayoutPreset[]): LayoutPreset[] {
  return [...BUILT_IN_PRESETS, ...customPresets];
}

export const useLayoutPresetStore = create<LayoutPresetState>()(
  persist(
    (set, get) => ({
      activePresetId: null,
      customPresets: [],

      applyPreset: (id: string) => {
        const all = getAllPresets(get().customPresets);
        const preset = all.find((p) => p.id === id);
        if (!preset) return;

        const shell = useShellStore.getState();

        // Apply sidebar state
        if (preset.sidebarCollapsed !== shell.sidebarCollapsed) {
          shell.toggleSidebar();
        }

        // Apply thread state — guard: only open thread if a root message is selected
        if (preset.isThreadOpen && shell.selectedRootMessageId) {
          shell.openThreadForMessage(shell.selectedRootMessageId);
        } else if (!preset.isThreadOpen && shell.isThreadOpen) {
          shell.closeThread();
        }

        // Apply pinned panel
        shell.setPinnedPanelOpen(preset.pinnedPanelOpen);

        // Apply zen mode
        if (preset.zenMode !== shell.zenMode) {
          shell.toggleZenMode();
        }

        set({ activePresetId: id });
      },

      cyclePresets: () => {
        const { activePresetId, customPresets } = get();
        const all = getAllPresets(customPresets);
        if (all.length === 0) return;

        const currentIndex = activePresetId
          ? all.findIndex((p) => p.id === activePresetId)
          : -1;
        const nextIndex = (currentIndex + 1) % all.length;
        const next = all[nextIndex];

        get().applyPreset(next.id);
        toast.success(`Layout: ${next.name}`);
      },

      saveCurrentAsPreset: (name: string) => {
        const shell = useShellStore.getState();
        const id = `custom-${Date.now()}`;
        const preset: LayoutPreset = {
          id,
          name,
          sidebarCollapsed: shell.sidebarCollapsed,
          isThreadOpen: shell.isThreadOpen,
          pinnedPanelOpen: shell.pinnedPanelOpen,
          zenMode: shell.zenMode,
        };
        set((state) => ({
          customPresets: [...state.customPresets, preset],
          activePresetId: id,
        }));
        toast.success(`Saved layout: ${name}`);
      },

      deletePreset: (id: string) => {
        set((state) => ({
          customPresets: state.customPresets.filter((p) => p.id !== id),
          activePresetId: state.activePresetId === id ? null : state.activePresetId,
        }));
      },
    }),
    { name: "rim-layout-presets" },
  ),
);
