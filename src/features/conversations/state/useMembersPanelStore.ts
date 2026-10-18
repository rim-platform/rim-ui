import { create } from "zustand";

type MembersPanelState = {
  /** Whether the tool panel shows the open conversation's members instead of the list. */
  open: boolean;
  /** The conversation whose members panel shows its invite picker; closing the panel clears it. */
  invitingIn: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Opens the panel with its invite picker, for `conversationId`. */
  openInvite: (conversationId: string) => void;
  closeInvite: () => void;
};

export const useMembersPanelStore = create<MembersPanelState>((set) => ({
  open: false,
  invitingIn: null,
  setOpen: (open) => set(open ? { open } : { open, invitingIn: null }),
  toggle: () => set((s) => (s.open ? { open: false, invitingIn: null } : { open: true })),
  openInvite: (conversationId) => set({ open: true, invitingIn: conversationId }),
  closeInvite: () => set({ invitingIn: null }),
}));
