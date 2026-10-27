import { create } from "zustand";

/** Which workspace action a dialog is open for. */
export type WorkspaceAction = "leave" | "rename";

/** The leave or rename dialog that is open, and for which workspace. */
interface WorkspaceActionState {
  action: { kind: WorkspaceAction; workspaceId: string } | null;
  open: (kind: WorkspaceAction, workspaceId: string) => void;
  close: () => void;
}

export const useWorkspaceActionStore = create<WorkspaceActionState>((set) => ({
  action: null,
  open: (kind, workspaceId) => set({ action: { kind, workspaceId } }),
  close: () => set({ action: null }),
}));
