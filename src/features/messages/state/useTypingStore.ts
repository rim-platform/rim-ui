import { create } from "zustand";

interface TypingEntry {
  userId: string;
  username: string;
  expiresAt: number;
}

interface TypingState {
  typingByConversation: Record<string, TypingEntry[]>;
  addTyping: (conversationId: string, userId: string, username: string) => void;
  removeExpired: () => void;
}

const TYPING_TTL_MS = 5000;

export const useTypingStore = create<TypingState>((set) => ({
  typingByConversation: {},
  addTyping: (conversationId, userId, username) =>
    set((state) => {
      const existing = state.typingByConversation[conversationId] ?? [];
      const now = Date.now();
      const expiresAt = now + TYPING_TTL_MS;
      const filtered = existing.filter((e) => e.userId !== userId && e.expiresAt > now);
      return {
        typingByConversation: {
          ...state.typingByConversation,
          [conversationId]: [...filtered, { userId, username, expiresAt }],
        },
      };
    }),
  removeExpired: () =>
    set((state) => {
      const now = Date.now();
      const next: Record<string, TypingEntry[]> = {};
      let changed = false;
      for (const [convId, entries] of Object.entries(state.typingByConversation)) {
        const alive = entries.filter((e) => e.expiresAt > now);
        if (alive.length !== entries.length) changed = true;
        if (alive.length > 0) {
          next[convId] = alive;
        } else {
          changed = true;
        }
      }
      return changed ? { typingByConversation: next } : state;
    }),
}));
