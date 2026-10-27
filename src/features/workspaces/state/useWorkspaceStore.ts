import { create } from "zustand";

import { useShellStore } from "../../../shell/state/useShellStore";

type WorkspaceState = {
  workspaceId: string | null;
  /**
   * Opens a workspace with no conversation selected. A way back from a DM is forgotten unless
   * `id` is the direct space that DM is in.
   */
  setWorkspaceId: (id: string) => void;
  /** Closes the open workspace and forgets any way back from a DM. */
  clearWorkspaceId: () => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceId: null,
  setWorkspaceId: (id) => {
    const shell = useShellStore.getState();
    if (shell.directOrigin && shell.directOrigin.spaceId !== id) shell.setDirectOrigin(null);
    set({ workspaceId: id });
    shell.setSelectedConversationId(null);
  },
  clearWorkspaceId: () => {
    useShellStore.getState().setDirectOrigin(null);
    set({ workspaceId: null });
  },
}));
