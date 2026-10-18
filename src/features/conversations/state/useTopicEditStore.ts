import { create } from "zustand";

type TopicEditState = {
  /** The channel whose topic the conversation header edits, or `null`. */
  conversationId: string | null;
  /** The topic as typed so far. */
  draft: string;
  /** Starts editing `conversationId`'s topic from `topic`. */
  start: (conversationId: string, topic: string) => void;
  setDraft: (draft: string) => void;
  stop: () => void;
};

/**
 * The topic edit in the conversation header, which the header's topic and a channel's
 * Edit topic… menu item start.
 */
export const useTopicEditStore = create<TopicEditState>((set) => ({
  conversationId: null,
  draft: "",
  start: (conversationId, topic) => set({ conversationId, draft: topic }),
  setDraft: (draft) => set({ draft }),
  stop: () => set({ conversationId: null, draft: "" }),
}));
