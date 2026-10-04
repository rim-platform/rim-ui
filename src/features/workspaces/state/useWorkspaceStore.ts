import { create } from "zustand";

import { useShellStore } from "../../../shell/state/useShellStore";

type WorkspaceState = {
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  clearWorkspaceId: () => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceId: null,
  setWorkspaceId: (id) => {
    set({ workspaceId: id });
    useShellStore.getState().setSelectedConversationId(null);
  },
  clearWorkspaceId: () => set({ workspaceId: null }),
}));
