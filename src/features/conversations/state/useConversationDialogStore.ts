import { create } from "zustand";

interface ConversationDialogState {
  /** The workspace whose channels the browse dialog lists, while it is open. */
  browseChannelsIn: string | null;
  /** The conversation the agent's warning is open for, while it is open. */
  agentWarningFor: string | null;
  openBrowseChannels: (workspaceId: string) => void;
  closeBrowseChannels: () => void;
  openAgentWarning: (conversationId: string) => void;
  closeAgentWarning: () => void;
}

/** The dialogs the conversation commands open, shown by `ConversationCommandHost`. */
export const useConversationDialogStore = create<ConversationDialogState>((set) => ({
  browseChannelsIn: null,
  agentWarningFor: null,
  openBrowseChannels: (workspaceId) => set({ browseChannelsIn: workspaceId }),
  closeBrowseChannels: () => set({ browseChannelsIn: null }),
  openAgentWarning: (conversationId) => set({ agentWarningFor: conversationId }),
  closeAgentWarning: () => set({ agentWarningFor: null }),
}));
