/**
 * What the UI shows about each encrypted conversation on this device: its group's state as
 * the encryption backend reports it, the members who are not ready for encryption yet, the
 * pending adds of a direct message this device refused, and, in the web app, whether this
 * browser can take part in encrypted conversations.
 */

import { create } from "zustand";

import type { GroupView } from "../api/e2eeCommands";

/**
 * Whether this browser takes part in encrypted conversations for the signed-in account:
 * `ready`; `checking` until it is known; `noDeviceKey` without a device key of its own;
 * `otherTab` while another tab of this browser runs them; `unsupported` when the browser cannot
 * (no WebCrypto Ed25519, IndexedDB or WebAssembly).
 */
export type WebEncryption = "ready" | "checking" | "noDeviceKey" | "otherTab" | "unsupported";

interface E2eeState {
  /** Group state per conversation id, refreshed after every operation on it. */
  groups: Record<string, GroupView>;
  /** Display names of members without a device set up for encryption, per conversation. */
  notReady: Record<string, string[]>;
  /** Principals of pending adds refused in a direct message (not one of its two), per conversation. */
  refusedAdds: Record<string, string[]>;
  webEncryption: WebEncryption;
  setGroup: (group: GroupView) => void;
  setNotReady: (conversationId: string, names: string[]) => void;
  setRefusedAdds: (conversationId: string, principals: string[]) => void;
  setWebEncryption: (support: WebEncryption) => void;
  clear: () => void;
}

export const useE2eeStore = create<E2eeState>((set) => ({
  groups: {},
  notReady: {},
  refusedAdds: {},
  webEncryption: "checking",
  setGroup: (group) => set((s) => ({ groups: { ...s.groups, [group.conversationId]: group } })),
  setNotReady: (conversationId, names) =>
    set((s) => ({ notReady: { ...s.notReady, [conversationId]: names } })),
  setRefusedAdds: (conversationId, principals) =>
    set((s) => {
      const current = s.refusedAdds[conversationId] ?? [];
      if (current.join() === principals.join()) return s;
      return { refusedAdds: { ...s.refusedAdds, [conversationId]: principals } };
    }),
  setWebEncryption: (webEncryption) => set({ webEncryption }),
  clear: () => set({ groups: {}, notReady: {}, refusedAdds: {} }),
}));
