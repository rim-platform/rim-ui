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
  pinnedMessages: (workspaceId?: string, conversationId?: string) =>
    ["pinnedMessages", workspaceId, conversationId] as const,
  customEmojis: (serverId?: string) => ["customEmojis", serverId] as const,
  plugins: () => ["plugins"] as const,
  macros: (serverId?: string) => ["macros", serverId] as const,
  lenses: (workspaceId?: string, conversationId?: string) =>
    ["lenses", workspaceId, conversationId] as const,
  lensMessages: (workspaceId?: string, conversationId?: string, lensId?: string) =>
    ["lensMessages", workspaceId, conversationId, lensId] as const,
  activeIncident: (serverId?: string, conversationId?: string) =>
    ["activeIncident", serverId, conversationId] as const,
  incidentTimeline: (incidentId?: string) =>
    ["incidentTimeline", incidentId] as const,
  keybinds: (scope?: string, workspaceId?: string) =>
    ["keybinds", scope, workspaceId] as const,
  unreadCounts: (workspaceId?: string) =>
    ["unreadCounts", workspaceId] as const,
  mutedConversations: (workspaceId?: string) =>
    ["mutedConversations", workspaceId] as const,
  workspaceState: (serverId?: string, scope?: string, key?: string) =>
    ["workspaceState", serverId, scope ?? "SERVER", key] as const,
  workspaceStateList: (serverId?: string, scope?: string, prefix?: string) =>
    ["workspaceStateList", serverId, scope ?? "SERVER", prefix] as const,
  pipelines: (serverId?: string) => ["pipelines", serverId] as const,
};
