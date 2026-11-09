import { create } from "zustand";

/** What the commands that answer an invitation do for the invitation on screen. */
export interface InvitationActions {
  /** The conversation the invitation is to. */
  conversationId: string;
  /** Joins; `false` when this device is not ready for the encrypted conversation. */
  accept: () => boolean;
  decline: () => void;
}

interface InvitationActionsState {
  /** Set while an invitation is shown in place of a conversation. */
  actions: InvitationActions | null;
  setActions: (actions: InvitationActions | null) => void;
}

/** The link from the invitation commands, which run outside React, to the invitation shown. */
export const useInvitationActionsStore = create<InvitationActionsState>((set) => ({
  actions: null,
  setActions: (actions) => set({ actions }),
}));
