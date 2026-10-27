import { create } from "zustand";

/** The timeline message a conversation's composer replies to. */
export interface ReplyTarget {
  messageId: string;
  authorId: string;
  /** The parent's first line as the quote shows it. */
  excerpt: string;
}

type ReplyTargetState = {
  /** Per conversation id. */
  targets: Record<string, ReplyTarget>;
  start: (conversationId: string, target: ReplyTarget) => void;
  clear: (conversationId: string) => void;
};

/** The reply each conversation's composer is writing, set by Reply and cleared on send. */
export const useReplyTargetStore = create<ReplyTargetState>((set) => ({
  targets: {},
  start: (conversationId, target) =>
    set((s) => ({ targets: { ...s.targets, [conversationId]: target } })),
  clear: (conversationId) =>
    set((s) => {
      if (!(conversationId in s.targets)) return s;
      const next = { ...s.targets };
      delete next[conversationId];
      return { targets: next };
    }),
}));
