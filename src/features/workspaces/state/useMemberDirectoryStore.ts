import { create } from "zustand";

type MemberDirectoryState = {
  /** Whether the tool panel shows the workspace member directory. */
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useMemberDirectoryStore = create<MemberDirectoryState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
