export interface LayoutPreset {
  id: string;
  name: string;
  sidebarCollapsed: boolean;
  isThreadOpen: boolean; // only applies if a thread is selected
  pinnedPanelOpen: boolean;
  zenMode: boolean;
}

export const BUILT_IN_PRESETS: LayoutPreset[] = [
  { id: "focus", name: "Focus", sidebarCollapsed: true, isThreadOpen: false, pinnedPanelOpen: false, zenMode: false },
  { id: "review", name: "Review", sidebarCollapsed: false, isThreadOpen: true, pinnedPanelOpen: false, zenMode: false },
  { id: "triage", name: "Triage", sidebarCollapsed: false, isThreadOpen: false, pinnedPanelOpen: false, zenMode: false },
];
