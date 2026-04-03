export const queryKeys = {
  healthCheck: ["healthCheck"] as const,
  me: ["me"] as const,
  myServers: () => ["myServers"] as const,
  serverMembers: (serverId?: string) => ["serverMembers", serverId] as const,
  server: (serverId?: string) => ["server", serverId] as const,
  conversations: (workspaceId?: string) => ["conversations", workspaceId] as const,
  messages: (workspaceId?: string, conversationId?: string) =>
    ["messages", workspaceId, conversationId] as const,
  threadByRoot: (workspaceId?: string, conversationId?: string, rootMessageId?: string) =>
    ["threadByRoot", workspaceId, conversationId, rootMessageId] as const,
  threadMessages: (workspaceId?: string, conversationId?: string, threadId?: string) =>
    ["threadMessages", workspaceId, conversationId, threadId] as const,
  channels: (workspaceId?: string) => ["channels", workspaceId] as const,
  commands: (surface?: string) => ["commands", surface] as const,
  resolvedKeybinds: (workspaceId?: string) => ["resolvedKeybinds", workspaceId] as const,
  searchMessages: (workspaceId?: string, conversationId?: string, query?: string) =>
    ["searchMessages", workspaceId, conversationId, query] as const,
  plugins: () => ["plugins"] as const,
};
