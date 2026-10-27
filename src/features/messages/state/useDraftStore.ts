import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

interface DraftState {
  drafts: Record<string, string>;
  getDraft: (conversationId: string) => string;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      getDraft: (conversationId) => get().drafts[conversationId] ?? "",
      setDraft: (conversationId, text) =>
        set((state) => {
          if (!text) {
            const next = { ...state.drafts };
            delete next[conversationId];
            return { drafts: next };
          }
          return { drafts: { ...state.drafts, [conversationId]: text } };
        }),
      clearDraft: (conversationId) =>
        set((state) => {
          if (!state.drafts[conversationId]) return state;
          const next = { ...state.drafts };
          delete next[conversationId];
          return { drafts: next };
        }),
    }),
    {
      name: "rim-drafts",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useDraftStore);

/** The draft key of a thread's reply box, apart from its conversation's composer. */
export function threadDraftKey(conversationId: string, rootMessageId: string): string {
  return `thread:${conversationId}:${rootMessageId}`;
}
