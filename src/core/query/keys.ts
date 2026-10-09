export const queryKeys = {
  healthCheck: ["healthCheck"] as const,
  me: ["me"] as const,
  // Stage 3 key identity: the signed-in account's key log, devices and profile card, and the
  // accounts on a server this desktop holds device keys for.
  myKeyIdentity: ["myKeyIdentity"] as const,
  deviceKeyStatus: (principalId: string, keySeq: number | null) =>
    ["deviceKeyStatus", principalId, keySeq] as const,
  deviceKeyAccounts: (endpoint: string) => ["deviceKeyAccounts", endpoint] as const,
  // Where the identity key's backup in the history archive stands for this device.
  identityBackupStatus: (principalId: string, keySeq: number | null) =>
    ["identityBackupStatus", principalId, keySeq] as const,
  myServers: () => ["myServers"] as const,
  serverMembers: (serverId?: string) => ["serverMembers", serverId] as const,
  server: (serverId?: string) => ["server", serverId] as const,
  workspaceFeatures: (serverId?: string) => ["workspaceFeatures", serverId] as const,
  // Track 1.2 moderation: active bans, and message reports filtered by status (null = all).
  serverBans: (serverId?: string) => ["serverBans", serverId] as const,
  messageReports: (serverId?: string, status?: string | null) =>
    ["messageReports", serverId, status ?? null] as const,
  // One report with its verified encrypted content; under the reports root so a resolve
  // invalidates it too.
  messageReport: (serverId?: string, reportId?: string) =>
    ["messageReports", serverId, "report", reportId] as const,
  conversations: (workspaceId?: string) => ["conversations", workspaceId] as const,
  messages: (workspaceId?: string, conversationId?: string) =>
    ["messages", workspaceId, conversationId] as const,
  // The newest timeline page from the desktop app's local message cache (PR 9). Its own root,
  // so invalidating `messages` (a server refetch) does not re-read the cache.
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
  // Keyed by workspace too: the server filters out commands whose workspace feature is off
  // (Track 0.4), so the list differs per workspace.
  commands: (surface?: string, workspaceId?: string) => ["commands", surface, workspaceId] as const,
  resolvedKeybinds: (workspaceId?: string) => ["resolvedKeybinds", workspaceId] as const,
  searchMessages: (workspaceId?: string, conversationId?: string, query?: string) =>
    ["searchMessages", workspaceId, conversationId, query] as const,
  // Hits from the desktop app's local search index (PR 10). Keyed by the signed-in user, as the
  // cache is per account.
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
  activeIncident: (serverId?: string, conversationId?: string) =>
    ["activeIncident", serverId, conversationId] as const,
  incidentTimeline: (incidentId?: string) => ["incidentTimeline", incidentId] as const,
  listIncidents: (
    serverId?: string,
    statusFilter?: readonly string[] | null,
    severityFilter?: readonly string[] | null,
  ) =>
    [
      "listIncidents",
      serverId,
      statusFilter ? [...statusFilter].sort().join(",") : null,
      severityFilter ? [...severityFilter].sort().join(",") : null,
    ] as const,
  keybinds: (scope?: string, workspaceId?: string) => ["keybinds", scope, workspaceId] as const,
  unreadCounts: (workspaceId?: string) => ["unreadCounts", workspaceId] as const,
  mutedConversations: (workspaceId?: string) => ["mutedConversations", workspaceId] as const,
  workspaceState: (serverId?: string, scope?: string, key?: string) =>
    ["workspaceState", serverId, scope ?? "SERVER", key] as const,
  workspaceStateList: (serverId?: string, scope?: string, prefix?: string) =>
    ["workspaceStateList", serverId, scope ?? "SERVER", prefix] as const,
  pipelines: (serverId?: string) => ["pipelines", serverId] as const,
  listAuditLog: (typedVerb?: string, after?: string) =>
    ["listAuditLog", typedVerb ?? null, after ?? null] as const,
  serverConfig: () => ["serverConfig"] as const,
  previewInviteToken: (token: string) => ["previewInviteToken", token] as const,
  workspacePresence: (workspaceId?: string) => ["workspacePresence", workspaceId] as const,
  ingestTokens: (serverId?: string) => ["ingestTokens", serverId] as const,
  // Track C1 — on-call schedules + escalation (schedule/rotation CRUD landed at C1a/C1c;
  // escalation-policy keys are added once the backend GraphQL surface lands — see
  // docs/oncall-ui.md for the current contract gap).
  onCallSchedules: (serverId?: string) => ["onCallSchedules", serverId] as const,
  serverOnCall: (serverId?: string) => ["serverOnCall", serverId] as const,
  // Keyed by scheduleId, not serverId/workspaceId — see VOLATILE_GLOBAL_KEY_ROOTS below.
  whoIsOnCall: (scheduleId?: string, at?: string) =>
    ["whoIsOnCall", scheduleId, at ?? null] as const,
  onCallShifts: (scheduleId?: string, from?: string, to?: string) =>
    ["onCallShifts", scheduleId, from, to] as const,
  escalationPolicies: (serverId?: string) => ["escalationPolicies", serverId] as const,
  // Track 1.3 notification rules: the viewer's settings, inbox (keyed by the unread-only filter;
  // the `["notifications", serverId]` prefix covers both lists) and the bell's unread count.
  notificationSettings: (serverId?: string) => ["notificationSettings", serverId] as const,
  notifications: (serverId?: string, unreadOnly?: boolean) =>
    ["notifications", serverId, unreadOnly ?? false] as const,
  unreadNotificationCount: (serverId?: string) => ["unreadNotificationCount", serverId] as const,
};

/**
 * Query-key roots holding volatile server state scoped to one workspace (server).
 * On WS reconnect we invalidate only these for the active workspace instead of the
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
  "workspaceFeatures",
  "serverBans",
  "messageReports",
  "customEmojis",
  "workspaceState",
  "workspaceStateList",
  "pipelines",
  "macros",
  "resolvedKeybinds",
  "activeIncident",
  "listIncidents",
  // Ingest tokens (Track B2 §2a management UI) aren't built yet — this root
  // is added ahead of that feature landing so reconnect scoping already
  // covers it once `useIngestTokens` exists; harmless no-op until then.
  "ingestTokens",
  // Track C1: schedule list + the serverOnCall batch resolver are both keyed by
  // serverId/workspaceId at position [1], so they fit the same prefix-match scheme.
  "onCallSchedules",
  "serverOnCall",
  "escalationPolicies",
  "notificationSettings",
  "notifications",
  "unreadNotificationCount",
] as const;

/**
 * Volatile roots NOT scoped by workspace id in their key (e.g. incident timelines are
 * keyed by incidentId). Invalidated by root prefix on reconnect. Safe because a user
 * views one active workspace at a time; worst case is one redundant refetch.
 */
export const VOLATILE_GLOBAL_KEY_ROOTS = [
  "incidentTimeline",
  // Track C1: keyed by scheduleId, not workspaceId — a `[root, workspaceId]` prefix
  // would never match these (scheduleId !== workspaceId), so they can't share
  // VOLATILE_WORKSPACE_KEY_ROOTS; invalidate by root name alone on reconnect instead,
  // same as incidentTimeline above.
  "whoIsOnCall",
  "onCallShifts",
] as const;
