import { create } from "zustand";

type MembersPanelState = {
  /** Whether the tool panel shows the open conversation's members instead of the list. */
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useMembersPanelStore = create<MembersPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
