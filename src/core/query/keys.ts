export const queryKeys = {
  healthCheck: ["healthCheck"] as const,
  me: ["me"] as const,
  // Key identity: the signed-in account's key log, devices and profile card, and the accounts
  // on a server this desktop holds device keys for.
  myKeyIdentity: ["myKeyIdentity"] as const,
  deviceKeyStatus: (principalId: string, keySeq: number | null) =>
    ["deviceKeyStatus", principalId, keySeq] as const,
  deviceKeyAccounts: (endpoint: string) => ["deviceKeyAccounts", endpoint] as const,
  unsavedRecoveryKit: (principalId: string) => ["unsavedRecoveryKit", principalId] as const,
  // Where the identity key's backup in the history archive stands for this device.
  identityBackupStatus: (principalId: string, keySeq: number | null) =>
    ["identityBackupStatus", principalId, keySeq] as const,
  myServers: () => ["myServers"] as const,
  serverMembers: (serverId?: string) => ["serverMembers", serverId] as const,
  server: (serverId?: string) => ["server", serverId] as const,
  // Moderation: active bans, and message reports filtered by status (null = all), with the
  // authors' principal ids when an instance operator reads the direct space's reports.
  serverBans: (serverId?: string) => ["serverBans", serverId] as const,
  messageReports: (serverId?: string, status?: string | null, withAuthorPrincipal = false) =>
    ["messageReports", serverId, status ?? null, withAuthorPrincipal] as const,
  // One report with its verified encrypted content; under the reports root so a resolve
  // invalidates it too.
  messageReport: (serverId?: string, reportId?: string) =>
    ["messageReports", serverId, "report", reportId] as const,
  // A workspace's invites as its owner lists them, newest first.
  workspaceInvites: (serverId?: string) => ["workspaceInvites", serverId] as const,
  // A workspace's public link as its owner sees it: settings, the link and its use.
  publicJoinLink: (serverId?: string) => ["publicJoinLink", serverId] as const,
  // What a public link shows; keyed by the signed-in user, whose standing the answer carries.
  publicJoinLinkPreview: (token: string, userId?: string | null) =>
    ["publicJoinLinkPreview", token, userId ?? null] as const,
  // A workspace's open join requests and their count; the `["joinRequests", serverId]` prefix
  // covers both.
  joinRequests: (serverId?: string) => ["joinRequests", serverId, "list"] as const,
  joinRequestCount: (serverId?: string) => ["joinRequests", serverId, "count"] as const,
  // The signed-in account's own open join requests.
  myJoinRequests: ["myJoinRequests"] as const,
  conversations: (workspaceId?: string) => ["conversations", workspaceId] as const,
  messages: (workspaceId?: string, conversationId?: string) =>
    ["messages", workspaceId, conversationId] as const,
  // The newest timeline page from the desktop app's local message cache. Its own root, so
  // invalidating `messages` (a server refetch) does not re-read the cache.
  cachedTimeline: (workspaceId?: string, conversationId?: string) =>
    ["cachedTimeline", workspaceId, conversationId] as const,
  threadByRoot: (workspaceId?: string, conversationId?: string, rootMessageId?: string) =>
    ["threadByRoot", workspaceId, conversationId, rootMessageId] as const,
  threadMessages: (workspaceId?: string, conversationId?: string, threadId?: string) =>
    ["threadMessages", workspaceId, conversationId, threadId] as const,
  // Every channel the viewer can see that is not archived (the browse list). Also the prefix of
  // `joinedChannels`, so invalidating it refreshes both lists.
  channels: (workspaceId?: string) => ["channels", workspaceId] as const,
  // Channels the viewer has joined, archived ones included (the sidebar list).
  joinedChannels: (workspaceId?: string) => ["channels", workspaceId, "joined"] as const,
  // One conversation by id: the open conversation's header, composer gate and members panel.
  conversation: (workspaceId?: string, conversationId?: string) =>
    ["conversation", workspaceId, conversationId] as const,
  // Keyed by workspace too: the list is fetched with the active workspace as context.
  commands: (surface?: string, workspaceId?: string) => ["commands", surface, workspaceId] as const,
  resolvedKeybinds: (workspaceId?: string) => ["resolvedKeybinds", workspaceId] as const,
  // The signed-in account's user commands with their saved steps, and one of them by id; the
  // `["userCommands"]` prefix covers both.
  userCommands: ["userCommands"] as const,
  userCommand: (id?: string | null) => ["userCommands", "byId", id ?? null] as const,
  searchMessages: (workspaceId?: string, conversationId?: string, query?: string) =>
    ["searchMessages", workspaceId, conversationId, query] as const,
  // Hits from the desktop app's local search index. Keyed by the signed-in user, as the cache
  // is per account.
  localSearchMessages: (
    workspaceId?: string,
    userId?: string,
    conversationId?: string,
    query?: string,
  ) => ["localSearchMessages", workspaceId, userId, conversationId, query] as const,
  pinnedMessages: (workspaceId?: string, conversationId?: string) =>
    ["pinnedMessages", workspaceId, conversationId] as const,
  customEmojis: (serverId?: string) => ["customEmojis", serverId] as const,
  plugins: () => ["plugins"] as const,
  // One plugin's settings form, apart from the list so reloading the list leaves an open form alone.
  pluginSettings: (pluginId: string) => ["pluginSettings", pluginId] as const,
  // A workspace's plugin registry, and each entry's verification on this device.
  workspacePlugins: (serverId?: string | null) => ["workspacePlugins", serverId] as const,
  // Whether this device holds the identity key that signs plugin manifests.
  pluginSigning: (principalId: string | null, keySeq: number | null) =>
    ["pluginSigning", principalId, keySeq] as const,
  workspacePluginChecks: (serverId?: string | null, hashes: readonly string[] = []) =>
    ["workspacePluginChecks", serverId, ...hashes] as const,
  macros: (serverId?: string) => ["macros", serverId] as const,
  lenses: (workspaceId?: string, conversationId?: string) =>
    ["lenses", workspaceId, conversationId] as const,
  lensMessages: (workspaceId?: string, conversationId?: string, lensId?: string) =>
    ["lensMessages", workspaceId, conversationId, lensId] as const,
  keybinds: (scope?: string, workspaceId?: string) => ["keybinds", scope, workspaceId] as const,
  unreadCounts: (workspaceId?: string) => ["unreadCounts", workspaceId] as const,
  mutedConversations: (workspaceId?: string) => ["mutedConversations", workspaceId] as const,
  workspaceState: (serverId?: string, scope?: string, key?: string) =>
    ["workspaceState", serverId, scope ?? "SERVER", key] as const,
  workspaceStateList: (serverId?: string, scope?: string, prefix?: string) =>
    ["workspaceStateList", serverId, scope ?? "SERVER", prefix] as const,
  pipelines: (serverId?: string) => ["pipelines", serverId] as const,
  listAuditLog: (serverId?: string, actorUserId?: string, typedVerb?: string, after?: string) =>
    [
      "listAuditLog",
      serverId ?? null,
      actorUserId ?? null,
      typedVerb ?? null,
      after ?? null,
    ] as const,
  serverConfig: () => ["serverConfig"] as const,
  // The server's release and API version; read once per session.
  serverInfo: ["serverInfo"] as const,
  // When the signed-in account's probation ends; under `me` so a refresh of the account covers it.
  probation: (userId?: string) => ["me", "probation", userId] as const,
  // Whether the server offers account deletion, and when the signed-in account's pending deletion
  // runs. Its own root, so a refresh of `me` does not ask a server that refused it again.
  accountDeletion: (userId?: string) => ["accountDeletion", userId] as const,
  previewInviteToken: (token: string) => ["previewInviteToken", token] as const,
  workspacePresence: (workspaceId?: string) => ["workspacePresence", workspaceId] as const,
  // Notification rules: the viewer's settings, inbox (keyed by the unread-only filter; the
  // `["notifications", serverId]` prefix covers both lists) and the bell's unread count.
  notificationSettings: (serverId?: string) => ["notificationSettings", serverId] as const,
  notifications: (serverId?: string, unreadOnly?: boolean) =>
    ["notifications", serverId, unreadOnly ?? false] as const,
  unreadNotificationCount: (serverId?: string) => ["unreadNotificationCount", serverId] as const,
  // The relay: contacts, the DM request inbox (keyed by status filter; the `["dmRequests"]`
  // prefix covers every list) and a person's identity as their relay serves it.
  relayContacts: ["relayContacts"] as const,
  dmRequests: (status?: string | null) => ["dmRequests", status ?? null] as const,
  remoteIdentity: (principalId?: string) => ["remoteIdentity", principalId] as const,
  // Who may start a DM: the caller's own choices, a workspace's policy, and whether the other
  // member of a direct conversation still has the caller's request pending.
  myDmSettings: ["myDmSettings"] as const,
  workspaceDmPolicy: (workspaceId?: string) => ["workspaceDmPolicy", workspaceId] as const,
  dmRequestPending: (workspaceId?: string, conversationId?: string) =>
    ["dmRequestPending", workspaceId, conversationId] as const,
  // Whether the signed-in account is an instance operator; under `me` like probation.
  instanceOperator: (userId?: string) => ["me", "instanceOperator", userId] as const,
  // The instance moderation queue: abuse reports keyed by the open-only filter, principal blocks
  // and the IP deny list. The `["instanceModeration"]` prefix covers all three.
  instanceReports: (openOnly: boolean) => ["instanceModeration", "reports", openOnly] as const,
  instancePrincipalBlocks: ["instanceModeration", "principalBlocks"] as const,
  instanceIpBlocks: ["instanceModeration", "ipBlocks"] as const,
};

/**
 * Query-key roots holding volatile server state scoped to one workspace (server).
 * A WS reconnect invalidates only these for the active workspace instead of the
 * whole cache. Each root keys the workspace/server id at position [1], so the prefix
 * [root, workspaceId] matches every query for that workspace.
 */
export const VOLATILE_WORKSPACE_KEY_ROOTS = [
  "messages",
  "conversations",
  "conversation",
  "channels",
  "threadByRoot",
  "threadMessages",
  "pinnedMessages",
  "searchMessages",
  "lenses",
  "lensMessages",
  "unreadCounts",
  "mutedConversations",
  "workspacePresence",
  "serverMembers",
  "server",
  "serverBans",
  "messageReports",
  "publicJoinLink",
  "joinRequests",
  "customEmojis",
  "workspaceState",
  "workspaceStateList",
  "pipelines",
  "macros",
  "resolvedKeybinds",
  "notificationSettings",
  "notifications",
  "unreadNotificationCount",
] as const;
