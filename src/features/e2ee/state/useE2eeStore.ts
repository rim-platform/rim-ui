/**
 * What the UI shows about each encrypted conversation on this device: its group's state as
 * the Tauri side reports it, and the members who are not ready for encryption yet.
 */

import { create } from "zustand";

import type { GroupView } from "../api/e2eeCommands";

interface E2eeState {
  /** Group state per conversation id, refreshed after every operation on it. */
  groups: Record<string, GroupView>;
  /** Display names of members without a device set up for encryption, per conversation. */
  notReady: Record<string, string[]>;
  setGroup: (group: GroupView) => void;
  setNotReady: (conversationId: string, names: string[]) => void;
  clear: () => void;
}

export const useE2eeStore = create<E2eeState>((set) => ({
  groups: {},
  notReady: {},
  setGroup: (group) => set((s) => ({ groups: { ...s.groups, [group.conversationId]: group } })),
  setNotReady: (conversationId, names) =>
    set((s) => ({ notReady: { ...s.notReady, [conversationId]: names } })),
  clear: () => set({ groups: {}, notReady: {} }),
}));
