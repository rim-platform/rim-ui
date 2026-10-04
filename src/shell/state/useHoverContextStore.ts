import { create } from "zustand";

export type HoverTarget =
  | { kind: "channel"; conversationId: string; serverId: string; label: string }
  | { kind: "dm"; conversationId: string; serverId: string; label: string }
  | { kind: "workspace"; workspaceId: string; label: string };

interface HoverContextState {
  target: HoverTarget | null;
  setTarget: (target: HoverTarget) => void;
  clear: () => void;
}

export const useHoverContextStore = create<HoverContextState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
