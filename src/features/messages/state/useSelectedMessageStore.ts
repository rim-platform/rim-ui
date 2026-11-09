import { create } from "zustand";

/** The message selected in a conversation's message list. */
export interface SelectedMessage {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

/**
 * What the commands that act on the selected message do, as the message list on screen does
 * them for its own messages.
 */
export interface SelectedMessageActions {
  /** The conversation the list shows. */
  conversationId: string;
  /** The text of a message as the list shows it, or `null` when the list does not hold it. */
  textOf: (messageId: string) => string | null;
  /** Starts a reply quoted above the composer; `false` where the person cannot reply. */
  reply: (messageId: string) => boolean;
  /** Starts editing the message in place; `false` when it is not the person's own. */
  edit: (messageId: string) => boolean;
  /** Opens the report dialog for the message; `false` when it is the person's own. */
  report: (messageId: string) => boolean;
}

interface SelectedMessageState {
  /** The selected message, while a message list has one. */
  selection: SelectedMessage | null;
  /** Set while a message list is mounted. */
  actions: SelectedMessageActions | null;
  select: (selection: SelectedMessage) => void;
  /** Drops the selection; with `conversationId`, only when it is in that conversation. */
  clear: (conversationId?: string) => void;
  setActions: (actions: SelectedMessageActions | null) => void;
}

/**
 * The message list's selection, shared with the commands that run outside React: keybinds, the
 * palette, quick boxes and the message box read it through the command context.
 */
export const useSelectedMessageStore = create<SelectedMessageState>((set) => ({
  selection: null,
  actions: null,
  select: (selection) =>
    set((s) =>
      s.selection?.messageId === selection.messageId &&
      s.selection.conversationId === selection.conversationId &&
      s.selection.workspaceId === selection.workspaceId
        ? s
        : { selection },
    ),
  clear: (conversationId) =>
    set((s) =>
      s.selection === null ||
      (conversationId !== undefined && s.selection.conversationId !== conversationId)
        ? s
        : { selection: null },
    ),
  setActions: (actions) => set({ actions }),
}));
