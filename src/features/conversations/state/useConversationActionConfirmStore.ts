import { create } from "zustand";

import type { ConversationActionConfirmation } from "../conversationActionTexts";

interface ConversationActionConfirmState {
  request: ConversationActionConfirmation | null;
  /** Show the dialog; resolves `true` only when the user confirms the action. */
  ask: (request: ConversationActionConfirmation) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}

let pending: ((confirmed: boolean) => void) | null = null;

function settle(confirmed: boolean): void {
  const resolve = pending;
  pending = null;
  resolve?.(confirmed);
}

/**
 * The confirmation a leave or archive command asks for before it runs. Only the dialog settles
 * it. One request at a time: while the user reads one, any other is declined.
 */
export const useConversationActionConfirmStore = create<ConversationActionConfirmState>((set) => ({
  request: null,
  ask: (request) => {
    if (pending) return Promise.resolve(false);
    const answer = new Promise<boolean>((resolve) => {
      pending = resolve;
    });
    set({ request });
    return answer;
  },
  confirm: () => {
    set({ request: null });
    settle(true);
  },
  cancel: () => {
    set({ request: null });
    settle(false);
  },
}));
