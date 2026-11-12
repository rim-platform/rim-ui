import { create } from "zustand";

interface ConversationDialogState {
  /** The workspace whose channels the browse dialog lists, while it is open. */
  browseChannelsIn: string | null;
  /** The workspace the invite dialog invites people to, while it is open from outside it. */
  inviteTo: string | null;
  /** The workspace the new-channel dialog creates a channel in, while it is open from outside it. */
  createChannelIn: string | null;
  /** The conversation the agent's warning is open for, while it is open. */
  agentWarningFor: string | null;
  openBrowseChannels: (workspaceId: string) => void;
  closeBrowseChannels: () => void;
  openInvite: (workspaceId: string) => void;
  closeInvite: () => void;
  openCreateChannel: (workspaceId: string) => void;
  closeCreateChannel: () => void;
  openAgentWarning: (conversationId: string) => void;
  closeAgentWarning: () => void;
}

/** The dialogs the conversation commands open, shown by `ConversationCommandHost`. */
export const useConversationDialogStore = create<ConversationDialogState>((set) => ({
  browseChannelsIn: null,
  inviteTo: null,
  createChannelIn: null,
  agentWarningFor: null,
  openBrowseChannels: (workspaceId) => set({ browseChannelsIn: workspaceId }),
  closeBrowseChannels: () => set({ browseChannelsIn: null }),
  openInvite: (workspaceId) => set({ inviteTo: workspaceId }),
  closeInvite: () => set({ inviteTo: null }),
  openCreateChannel: (workspaceId) => set({ createChannelIn: workspaceId }),
  closeCreateChannel: () => set({ createChannelIn: null }),
  openAgentWarning: (conversationId) => set({ agentWarningFor: conversationId }),
  closeAgentWarning: () => set({ agentWarningFor: null }),
}));
