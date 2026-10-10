export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: { input: string; output: string; }
  /** A scalar that can represent any JSON value. */
  JSON: { input: unknown; output: unknown; }
};

export type AddWorkspacePluginInput = {
  /** Only for a bundle source; omitted, this server's copy, which must have been uploaded. */
  bundleUrl?: InputMaybe<Scalars['String']['input']>;
  /** Required when the publisher is not enrolled on this server. */
  publisherKeyLog?: InputMaybe<Array<SignedStatementInput>>;
  serverId: Scalars['ID']['input'];
  statement: SignedStatementInput;
  status: WorkspacePluginStatus;
};

export type Attachment = {
  /** Unpadded base64url SHA-256 of an encrypted conversation's blob. */
  blobSha256?: Maybe<Scalars['String']['output']>;
  contentType: Scalars['String']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sizeBytes: Scalars['Int']['output'];
  status: AttachmentStatusEnum;
};

export enum AttachmentStatusEnum {
  FAILED = 'FAILED',
  PENDING_UPLOAD = 'PENDING_UPLOAD',
  READY = 'READY',
  UPLOADED = 'UPLOADED'
}

export type AuditLogEntry = {
  actorUserId: Scalars['ID']['output'];
  argsRedacted: Scalars['JSON']['output'];
  capabilityCheckOutcome?: Maybe<Scalars['String']['output']>;
  commandId: Scalars['String']['output'];
  confirmationKind: Scalars['String']['output'];
  confirmationOutcome?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  dangerous: Scalars['Boolean']['output'];
  errorKind?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  initiator: Scalars['String']['output'];
  outcome: AuditOutcomeGql;
  sensitivity: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  typedVerb?: Maybe<TypedVerbGql>;
};

export type AuditLogFilterInput = {
  actorUserId?: InputMaybe<Scalars['ID']['input']>;
  commandId?: InputMaybe<Scalars['String']['input']>;
  serverId?: InputMaybe<Scalars['ID']['input']>;
  since?: InputMaybe<Scalars['String']['input']>;
  typedVerb?: InputMaybe<TypedVerbGql>;
  until?: InputMaybe<Scalars['String']['input']>;
};

export type AuditLogPage = {
  items: Array<AuditLogEntry>;
  /** Opaque cursor pointing after the last item; pass to `after` on next query. */
  nextCursor?: Maybe<Scalars['String']['output']>;
  pageInfo: AuditLogPageInfo;
};

export type AuditLogPageInfo = {
  hasNextPage: Scalars['Boolean']['output'];
  hasPrevPage: Scalars['Boolean']['output'];
};

export type AuditLogPaginationInput = {
  /** Opaque cursor from the previous page's `nextCursor`. */
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * GraphQL enum for audit log outcome — mirrors [`rim_services::audit::dto::AuditOutcome`].
 * Rust variants → SCREAMING_SNAKE in GraphQL (e.g. `MacroPartialFailure` → `MACRO_PARTIAL_FAILURE`).
 */
export enum AuditOutcomeGql {
  CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED',
  ERROR = 'ERROR',
  MACRO_PARTIAL_FAILURE = 'MACRO_PARTIAL_FAILURE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  STEP_ERROR = 'STEP_ERROR',
  SUCCESS = 'SUCCESS'
}

export type ChannelCursorInput = {
  conversationId: Scalars['ID']['input'];
  createdAt: Scalars['DateTime']['input'];
};

export type ChannelCursorOutput = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
};

export type ChannelLens = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdBy: Scalars['ID']['output'];
  filterSpec: FilterSpecGql;
  id: Scalars['ID']['output'];
  isShared: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

/**
 * Narrows the `channels` query. By default it lists every channel the viewer can see (public
 * channels plus private channels they belong to) that is not archived.
 */
export type ChannelListFilter = {
  /** Include archived channels. */
  includeArchived?: Scalars['Boolean']['input'];
  /** Only channels the viewer has joined (the sidebar list). */
  joinedOnly?: Scalars['Boolean']['input'];
};

export type ChannelPage = {
  items: Array<Conversation>;
  next?: Maybe<ChannelCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<ChannelCursorOutput>;
};

export type ClaimMlsKeyPackagesInput = {
  conversationId: Scalars['ID']['input'];
  devices: Array<MlsDeviceRefInput>;
  serverId: Scalars['ID']['input'];
};

export type ClaimedKeyPackage = {
  deviceId: Scalars['ID']['output'];
  keyPackage: Scalars['String']['output'];
  keyPackageRef: Scalars['String']['output'];
  lastResort: Scalars['Boolean']['output'];
  principalId: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
};

export type Command = {
  /**
   * `true` iff the command is exposed to the AI Agent. Phase 1: always
   * `false` (no built-in opts in yet). Phase 4 starts flipping specific
   * commands on.
   */
  aiCallable: Scalars['Boolean']['output'];
  /**
   * Typed argument schema driving palette form rendering AND the AI
   * tool-schema generator's `input_schema`. Populated from the backend
   * `CommandDefinitionDto.arguments` field at resolve time — frontend
   * hardcoded schemas are removed in Phase 3 §4.B.
   */
  arguments: Array<CommandArgument>;
  category: Scalars['String']['output'];
  dangerous: Scalars['Boolean']['output'];
  description: Scalars['String']['output'];
  executionTarget: CommandExecutionTarget;
  id: Scalars['String']['output'];
  /**
   * Example phrases a user might speak/type to invoke this command.
   * Individually sanitized at registration; bounded in count and length.
   */
  intentSamples: Array<Scalars['String']['output']>;
  keybindCapable: Scalars['Boolean']['output'];
  /**
   * AI-optimised natural-language description; falls back to `description`
   * when absent. Sanitized at registration time, so the frontend can trust
   * this field even when rendering inside a prompt template.
   */
  nlDescription?: Maybe<Scalars['String']['output']>;
  requiredCapabilities: Array<Scalars['String']['output']>;
  requiredContext: Array<Scalars['String']['output']>;
  /**
   * Classification tier driving audit verbosity, mutating-call caps, and
   * the UX confirm-modal placement.
   */
  sensitivity: CommandSensitivity;
  sourceKind: CommandSourceKind;
  title: Scalars['String']['output'];
  visibleInContextMenus: Scalars['Boolean']['output'];
  visibleInPalette: Scalars['Boolean']['output'];
};

/**
 * GraphQL projection of [`rim_services::command::dto::CommandArgumentDto`].
 *
 * `default_value` and `allowed_values` carry the per-argument constraints
 * the AI tool-schema generator needs to emit a usable `input_schema` (Phase
 * 3 §4.B). `default_value` is wrapped in async-graphql's `Json` scalar
 * because typed args span string/int/float/bool/JSON-object — a single
 * scalar surface keeps the GraphQL schema flat.
 */
export type CommandArgument = {
  allowedValues?: Maybe<Array<Scalars['String']['output']>>;
  argumentType: CommandArgumentType;
  defaultValue?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  name: Scalars['String']['output'];
  required: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
};

/**
 * GraphQL enum mirroring [`rim_services::command::dto::CommandArgumentTypeDto`].
 *
 * Drives the frontend AI tool-schema generator (Phase 3 §4.B) — each variant
 * maps to a JSON-schema fragment for the `input_schema` field of an
 * `AiToolDefinition`. Wire contract: SCREAMING_SNAKE (`STRING`, `WORKSPACE_ID`,
 * `SELECTION_TEXT`, …) auto-generated by async-graphql's `Enum` derive.
 *
 * Adding a variant on the DTO without extending this enum + the `From`
 * match below is a compile error — that's the drift-prevention point.
 */
export enum CommandArgumentType {
  BOOLEAN = 'BOOLEAN',
  CONVERSATION_ID = 'CONVERSATION_ID',
  ENUM = 'ENUM',
  FLOAT = 'FLOAT',
  INTEGER = 'INTEGER',
  MESSAGE_ID = 'MESSAGE_ID',
  SELECTION_TEXT = 'SELECTION_TEXT',
  STRING = 'STRING',
  THREAD_ID = 'THREAD_ID',
  USER_ID = 'USER_ID',
  WORKSPACE_ID = 'WORKSPACE_ID'
}

export type CommandContextInput = {
  activePanel?: InputMaybe<Scalars['String']['input']>;
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  focusedSurface?: InputMaybe<Scalars['String']['input']>;
  selectedMessageId?: InputMaybe<Scalars['ID']['input']>;
  selectedMessageIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  selectedText?: InputMaybe<Scalars['String']['input']>;
  threadId?: InputMaybe<Scalars['ID']['input']>;
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};

export enum CommandExecutionTarget {
  BACKEND = 'BACKEND',
  DESKTOP_LOCAL = 'DESKTOP_LOCAL'
}

/**
 * GraphQL enum mirroring [`rim_services::command::initiator::CommandInitiator`].
 *
 * Must stay in sync with the DTO variants — the `From` impl below is the
 * enforcement point. Adding a variant on the DTO without extending this
 * enum + the match below is a compile error.
 *
 * Wire contract: SCREAMING_SNAKE variants (`PALETTE`, `AGENT`, `MACRO`,
 * `KEYBIND`, `CONTEXT_MENU`, `PLUGIN`, `CLI`) — async-graphql's
 * `Enum` derive handles the conversion. Auto-discovered by the schema
 * because it's referenced from `ExecuteCommandInput.initiator` and
 * `ExecuteMacroInput.initiator` — no explicit registration in `lib.rs`
 * is required.
 *
 * Per Fury v2 §3.11 (H4 part 1).
 */
export enum CommandInitiator {
  /** AI agent issued the command via the dispatcher. */
  AGENT = 'AGENT',
  /** Out-of-process CLI client (rim-cli). */
  CLI = 'CLI',
  /** Context menu (right-click) on a chat element. */
  CONTEXT_MENU = 'CONTEXT_MENU',
  /** Keyboard shortcut bound to a command. */
  KEYBIND = 'KEYBIND',
  /** Inside a macro / user command expansion. */
  MACRO = 'MACRO',
  /** User typed/clicked in the command palette. */
  PALETTE = 'PALETTE',
  /** Plugin's own runtime invoked the command. */
  PLUGIN = 'PLUGIN'
}

export type CommandResult = {
  /**
   * Populated **iff** `status == CONFIRMATION_REQUIRED`. Carries the
   * server-issued challenge (token + argsHash + expiresAt). The
   * frontend presents the modal, then re-issues the original
   * `executeCommand` mutation with `confirmation: { inBandToken: { ... } }`.
   */
  confirmationRequired?: Maybe<ConfirmationChallenge>;
  followUpCommands: Array<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
  pipelineStages?: Maybe<Array<PipeStageResult>>;
  status: CommandResultStatus;
};

export enum CommandResultStatus {
  /**
   * Command is `dangerous: true` and the caller did not submit a
   * matching [`ConfirmationProofInput`]. The accompanying
   * `confirmationRequired` field on the result carries the
   * server-issued challenge — present the modal, then re-submit with
   * `confirmation: { inBandToken: { token, argsHash } }`.
   */
  CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS'
}

/**
 * GraphQL enum mirroring [`rim_services::command::sensitivity::CommandSensitivityDto`].
 *
 * Must stay in sync with `CommandSensitivityDto` variants — the `From` impl
 * below is the enforcement point. Adding a variant on the DTO without
 * extending this enum + the match below is a compile error.
 *
 * Wire contract: SCREAMING_SNAKE variants (`SAFE`, `SENSITIVE`, `MUTATING`,
 * `RESTRICTED`) — async-graphql's `Enum` derive handles the conversion.
 * The frontend codegen picks this up via `/api/sdl` and mirrors it as a
 * TypeScript union.
 */
export enum CommandSensitivity {
  /** Mutates durable state; counts against agent mutating-call cap. */
  MUTATING = 'MUTATING',
  /** High-blast-radius admin/destructive; always requires confirmation. */
  RESTRICTED = 'RESTRICTED',
  /** Read-only, no user-visible side effects. */
  SAFE = 'SAFE',
  /** Tracked in audit but low blast radius. */
  SENSITIVE = 'SENSITIVE'
}

export enum CommandSourceKind {
  BUILT_IN = 'BUILT_IN',
  INTEGRATION = 'INTEGRATION',
  PLUGIN = 'PLUGIN',
  USER = 'USER'
}

export enum CommandSurface {
  AI = 'AI',
  CONTEXT_MENU = 'CONTEXT_MENU',
  KEYBIND_PICKER = 'KEYBIND_PICKER',
  PALETTE = 'PALETTE'
}

/**
 * GraphQL projection of a server-issued
 * [`rim_services::command::confirmation::ConfirmationChallengeDto`]. The
 * frontend opens its confirm-modal with these fields, then submits a
 * matching [`ConfirmationProofInput`].
 */
export type ConfirmationChallenge = {
  argsHash: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
  token: Scalars['String']['output'];
};

/**
 * GraphQL input for submitting a confirmation proof: the token and args
 * hash of the challenge a previous call returned.
 */
export type ConfirmationProofInput = {
  inBandToken: InBandTokenInput;
};

export type Contact = {
  addedAt: Scalars['DateTime']['output'];
  principalId: Scalars['String']['output'];
  relayUrls: Array<Scalars['String']['output']>;
};

export type Conversation = {
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  conversationType: ConversationTypeEnum;
  createdBy?: Maybe<Scalars['ID']['output']>;
  /**
   * The level that applies to the viewer now: `NONE` while muted, else `notificationLevel`,
   * else the workspace default.
   */
  effectiveNotificationLevel: NotificationLevel;
  /**
   * When the conversation became end-to-end encrypted; null for plaintext. Messages from
   * then on are encrypted.
   */
  encryptedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  isArchived: Scalars['Boolean']['output'];
  /** Whether the viewer is a member (for channels: has joined it). */
  isMember: Scalars['Boolean']['output'];
  isMuted: Scalars['Boolean']['output'];
  /** Channels only: visible to its members alone. Fixed at creation. */
  isPrivate: Scalars['Boolean']['output'];
  memberCount: Scalars['Int']['output'];
  memberIds: Array<Scalars['ID']['output']>;
  /** The conversation's current MLS group; null for plaintext and before the first Commit. */
  mlsGroup?: Maybe<MlsGroup>;
  /**
   * The viewer's own notification level for this conversation (Track 1.3); null inherits
   * the workspace default.
   */
  notificationLevel?: Maybe<NotificationLevel>;
  /** The conversation this one succeeds, on the host that held it; null for any other. */
  predecessor?: Maybe<ConversationPredecessor>;
  serverId: Scalars['ID']['output'];
  /**
   * Slow mode (Track 1.2): minimum seconds between two messages of the same non-moderator
   * member; `0` when off.
   */
  slowModeSeconds: Scalars['Int']['output'];
  title?: Maybe<Scalars['String']['output']>;
  topic?: Maybe<Scalars['String']['output']>;
};

/** How one conversation of a `messageChanges` request was answered. */
export enum ConversationChangesStatus {
  /**
   * The caller cannot read this conversation (removed from it, not a member of a private one,
   * or it does not exist). No changes; the cursor is echoed. Stop syncing it.
   */
  NO_ACCESS = 'NO_ACCESS',
  /** The changes after the requested cursor. */
  OK = 'OK',
  /**
   * The stored cursor is ahead of the server (its counters were reset). The changes start
   * from the beginning: drop the cached copy of this conversation, then apply them.
   */
  RESET = 'RESET'
}

/** The changes of one conversation after the requested cursor, oldest first. */
export type ConversationMessageChanges = {
  changes: Array<MessageChange>;
  conversationId: Scalars['ID']['output'];
  /** Store this and pass it as `after` next time. Opaque. */
  cursor: Scalars['String']['output'];
  /** More changes follow `cursor`; ask again with it right away. */
  hasMore: Scalars['Boolean']['output'];
  status: ConversationChangesStatus;
};

/** The viewer's level for one conversation, as returned by `setConversationNotificationLevel`. */
export type ConversationNotificationLevel = {
  conversationId: Scalars['ID']['output'];
  /** What applies now: `NONE` while muted, else `level`, else the workspace default. */
  effectiveLevel: NotificationLevel;
  /** The conversation's own level; null inherits the workspace default. */
  level?: Maybe<NotificationLevel>;
  mutedUntil?: Maybe<Scalars['DateTime']['output']>;
};

export type ConversationPage = {
  items: Array<Conversation>;
  next?: Maybe<InboxCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<InboxCursorOutput>;
};

/** The conversation a successor replaces, on the host that held it. */
export type ConversationPredecessor = {
  conversationId: Scalars['ID']['output'];
  hostServerId: Scalars['String']['output'];
};

export enum ConversationTypeEnum {
  CHANNEL = 'CHANNEL',
  DIRECT = 'DIRECT',
  GROUP = 'GROUP'
}

export type CreateAttachmentInput = {
  /** Required in an encrypted conversation: unpadded base64url SHA-256 of the blob. */
  blobSha256?: InputMaybe<Scalars['String']['input']>;
  contentType: Scalars['String']['input'];
  conversationId: Scalars['ID']['input'];
  filename: Scalars['String']['input'];
  messageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  sizeBytes: Scalars['Int']['input'];
};

export type CreateChannelLensInput = {
  conversationId: Scalars['ID']['input'];
  filterSpec: FilterSpecInput;
  isShared?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};

export type CreateConversationInput = {
  /**
   * DMs and groups only: end-to-end encrypted from creation. Every member needs a device set
   * up for encryption. Defaults to false.
   */
  encrypted?: InputMaybe<Scalars['Boolean']['input']>;
  /** For Channel conversations. */
  isChannel?: InputMaybe<Scalars['Boolean']['input']>;
  /** Channels only: visible to invited members alone. Cannot be changed later. */
  isPrivate?: Scalars['Boolean']['input'];
  /** For Group conversations. */
  memberIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** For DM conversations. */
  otherUserId?: InputMaybe<Scalars['ID']['input']>;
  /** The conversation this one succeeds, when its home is gone. */
  predecessor?: InputMaybe<PredecessorInput>;
  /**
   * People from other servers, in the direct space only. With no `otherUserId` or
   * `memberIds` and one remote member, the conversation is a DM with them.
   */
  remoteMembers?: InputMaybe<Array<RemoteMemberInput>>;
  serverId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomEmojiInput = {
  imageBase64: Scalars['String']['input'];
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};

export type CreateInviteInput = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  maxUses?: InputMaybe<Scalars['Int']['input']>;
  /**
   * Optional recipient to email the invite link to (Track B3). Validated server-side;
   * malformed addresses return a validation error.
   */
  recipientEmail?: InputMaybe<Scalars['String']['input']>;
  /**
   * Role granted on join (Track 1.2): `MEMBER` (default) or `GUEST`. Any other value is a
   * `VALIDATION` error.
   */
  role?: InputMaybe<ServerMemberRoleGql>;
  serverId: Scalars['ID']['input'];
};

export type CreateInvitePayload = {
  inviteId: Scalars['ID']['output'];
  inviteToken: Scalars['String']['output'];
};

export type CreateKeybindInput = {
  commandId: Scalars['String']['input'];
  context: KeybindContext;
  keystroke: Scalars['String']['input'];
  presetArgs?: InputMaybe<Scalars['JSON']['input']>;
  scope: KeybindScope;
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateMacroInput = {
  aiCallable?: Scalars['Boolean']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  intentSamples?: Array<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  nlDescription?: Scalars['String']['input'];
  sensitivity?: CommandSensitivity;
  serverId: Scalars['ID']['input'];
  steps: Array<MacroStepInput>;
};

export type CreatePipelineInput = {
  actions: Array<PipelineActionInput>;
  cooldownSecs?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<PipelineFilterInput>;
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
  trigger: PipelineTriggerInput;
};

export type CreateServerInput = {
  name: Scalars['String']['input'];
};

export type CreateUserCommandInput = {
  commandId: Scalars['String']['input'];
  description: Scalars['String']['input'];
  steps: Array<UserCommandStepInput>;
  title: Scalars['String']['input'];
};

export type CustomEmoji = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  imageUrl: Scalars['String']['output'];
  name: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  uploadedBy: Scalars['ID']['output'];
};

export type DeleteAttachmentInput = {
  attachmentId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type DeleteKeybindInput = {
  keybindId: Scalars['ID']['input'];
};

export type DeleteMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type DeleteUserCommandInput = {
  commandId: Scalars['String']['input'];
};

export type DeleteWorkspaceStateInput = {
  key: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
};

export type DeviceKey = {
  addedAt: Scalars['DateTime']['output'];
  certificate: SignedStatement;
  /** The client-chosen device id from the certificate. */
  deviceId: Scalars['ID']['output'];
  /** Key log seq whose identity key signed the certificate. */
  keySeq: Scalars['Int']['output'];
  lastUsedAt?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  /** The device key in tagged form, `<algorithm>:<base64url>` (today always `ed25519:…`). */
  publicKey: Scalars['String']['output'];
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type DeviceLink = {
  expiresAt: Scalars['DateTime']['output'];
  /** The new device's sealed offer, while `OFFERED` or `ANSWERED`. */
  offer?: Maybe<SealedMessage>;
  state: DeviceLinkState;
};

/** `EXPIRED` is a link that was still open, offered or answered when it expired. */
export enum DeviceLinkState {
  ANSWERED = 'ANSWERED',
  CANCELLED = 'CANCELLED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  OFFERED = 'OFFERED',
  OPEN = 'OPEN'
}

/** How often unread notifications are emailed. */
export enum DigestFrequency {
  DAILY = 'DAILY',
  HOURLY = 'HOURLY',
  OFF = 'OFF'
}

/** A conversation started by someone outside the caller's contacts. */
export type DmRequest = {
  /** The sender's profile card as the host sent it. */
  card: SignedStatement;
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  expiresAt: Scalars['DateTime']['output'];
  fromPrincipalId: Scalars['String']['output'];
  /** Up to three items of the conversation, held while the request is pending. */
  heldItems: Array<RelayItem>;
  hostServerId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  status: DmRequestStatus;
};

export enum DmRequestStatus {
  ACCEPTED = 'ACCEPTED',
  IGNORED = 'IGNORED',
  PENDING = 'PENDING'
}

/**
 * A daily do-not-disturb window. `start`/`end` are `"HH:MM"` wall-clock times in `timezone`
 * (an IANA name); the window crosses midnight when `end` is before `start`.
 */
export type DndWindow = {
  end: Scalars['String']['output'];
  start: Scalars['String']['output'];
  timezone: Scalars['String']['output'];
};

export type DndWindowInput = {
  /** `"HH:MM"` (or `"HH:MM:SS"`); must differ from `start`. */
  end: Scalars['String']['input'];
  /** `"HH:MM"` (or `"HH:MM:SS"`). */
  start: Scalars['String']['input'];
  /** IANA timezone name, e.g. `Europe/Prague`. */
  timezone: Scalars['String']['input'];
};

export type EditEncryptedMessageInput = {
  conversationId: Scalars['ID']['input'];
  envelope: Scalars['String']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type EditMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type EnrollIdentityKeyInput = {
  /** Certificate of the device enrolling; this session becomes its session. */
  device: SignedStatementInput;
  /** The whole key log, inception first. */
  keyLog: Array<SignedStatementInput>;
  /**
   * A `login` statement signed by that device over a fresh `keyLoginChallenge`, proving the
   * caller holds the device key.
   */
  proof: SignedStatementInput;
};

export type ExecuteCommandInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandContext?: InputMaybe<CommandContextInput>;
  commandId: Scalars['String']['input'];
  /**
   * Server-issued, server-verified confirmation proof. Required when
   * re-submitting after a previous `executeCommand` returned
   * `status: CONFIRMATION_REQUIRED`. Closes H1 (TOCTOU) by binding the
   * proof to `(actor, commandId, args, context)` server-side.
   */
  confirmation?: InputMaybe<ConfirmationProofInput>;
  /**
   * Who issued this command. Optional for back-compat — when omitted, the
   * backend defaults to `PALETTE` (the conservative human default). Phase
   * 4 frontend dispatcher will start sending the explicit value from every
   * call site (palette / agent / keybind / context-menu / macro). Until
   * then this field is opt-in.
   *
   * Per Fury v2 §3.11. The default is enforced server-side
   * (`CommandInitiator::default() == Palette`) so a client that submits
   * `null` is treated as a human action — never as agent action.
   */
  initiator?: InputMaybe<CommandInitiator>;
  isPipe?: InputMaybe<Scalars['Boolean']['input']>;
};

export type ExecuteMacroInput = {
  commandContext?: InputMaybe<CommandContextInput>;
  /**
   * Server-issued confirmation proof. Same shape and semantics as
   * `ExecuteCommandInput.confirmation`. Phase 1 note: macros are an
   * "all-or-nothing" confirmation surface — a single proof issued
   * at macro-execute time covers the whole expansion. Phase 4 may
   * add per-step proofs once the modal can render a step list.
   */
  confirmation?: InputMaybe<ConfirmationProofInput>;
  /**
   * Who triggered this macro. Same back-compat semantics as
   * `ExecuteCommandInput.initiator`: optional, server-defaults to
   * `PALETTE`.
   */
  initiator?: InputMaybe<CommandInitiator>;
  macroId: Scalars['ID']['input'];
};

export type FilterConditionGql = {
  field: FilterField;
  op: FilterOp;
  value: Scalars['JSON']['output'];
};

export type FilterConditionInput = {
  field: FilterField;
  op: FilterOp;
  value: Scalars['JSON']['input'];
};

export enum FilterField {
  AUTHOR_ID = 'AUTHOR_ID',
  HAS_ATTACHMENTS = 'HAS_ATTACHMENTS',
  HAS_LINKS = 'HAS_LINKS',
  IS_PINNED = 'IS_PINNED',
  TEXT_CONTAINS = 'TEXT_CONTAINS'
}

export enum FilterLogic {
  AND = 'AND',
  OR = 'OR'
}

export enum FilterOp {
  CONTAINS = 'CONTAINS',
  EQ = 'EQ',
  IN = 'IN'
}

export type FilterSpecGql = {
  conditions: Array<FilterConditionGql>;
  logic: FilterLogic;
};

export type FilterSpecInput = {
  conditions: Array<FilterConditionInput>;
  logic: FilterLogic;
};

export type FinalizeAttachmentInput = {
  attachmentId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type ForwardMessageInput = {
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  sourceConversationId: Scalars['ID']['input'];
  targetConversationId: Scalars['ID']['input'];
};

export type HeartbeatInput = {
  status: PresenceStatus;
  workspaceId: Scalars['ID']['input'];
};

export type InBandTokenInput = {
  argsHash: Scalars['String']['input'];
  token: Scalars['String']['input'];
};

export type InboxCursorInput = {
  conversationId: Scalars['ID']['input'];
  lastActivityAt: Scalars['DateTime']['input'];
};

export type InboxCursorOutput = {
  conversationId: Scalars['ID']['output'];
  lastActivityAt: Scalars['DateTime']['output'];
};

/**
 * Read-only preview of a registration token.
 *
 * Does NOT consume the token. Workspace-invite previews carry server and
 * inviter info; instance-invite previews are minimal.
 */
export type InviteTokenPreviewGql = {
  /** `None` for workspace invites that were issued without an expiry. */
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  tokenType: InviteTokenTypeGql;
  /** Populated only when `token_type == WORKSPACE`. */
  workspace?: Maybe<WorkspaceInvitePreviewGql>;
};

/**
 * GraphQL enum for the type of an invite token, used by `InviteTokenPreview`.
 *
 * Mirrors [`rim_services::auth::dto::InviteTokenType`].
 */
export enum InviteTokenTypeGql {
  /** Instance invite: routes to `instanceInviteToken` input on `signupWithInvite`. */
  INSTANCE = 'INSTANCE',
  /** Workspace invite: join-a-workspace flow. */
  WORKSPACE = 'WORKSPACE'
}

/** Join a workspace on another host through this relay. */
export type JoinRemoteWorkspaceInput = {
  /** A delegation of the signing device for this relay, the host and the workspace. */
  delegation: SignedStatementInput;
  /** The host's origin, from the invite link. */
  hostOrigin: Scalars['String']['input'];
  hostServerId: Scalars['String']['input'];
  /** The invite token; null for a current member. */
  inviteToken?: InputMaybe<Scalars['String']['input']>;
  /** A `login` statement over a `remoteJoinChallenge`, naming the host's server id. */
  proof: SignedStatementInput;
};

export type JoinServerByInviteInput = {
  inviteToken: Scalars['String']['input'];
};

export type JoinServerByInvitePayload = {
  serverId: Scalars['ID']['output'];
};

/**
 * What this server holds about the signed-in account's key identity. Before the account
 * enrolls a key, `principalId` and `keySeq` are null and the lists are empty.
 */
export type KeyIdentity = {
  /** Every device, revoked ones included, oldest first. */
  devices: Array<DeviceKey>;
  /** Oldest entry first. */
  keyLog: Array<KeyLogEntry>;
  keySeq?: Maybe<Scalars['Int']['output']>;
  principalId?: Maybe<Scalars['String']['output']>;
  profileCard?: Maybe<ProfileCard>;
};

export type KeyLogEntry = {
  createdAt: Scalars['DateTime']['output'];
  kind: KeyLogEntryKind;
  seq: Scalars['Int']['output'];
  statement: SignedStatement;
};

export enum KeyLogEntryKind {
  INCEPTION = 'INCEPTION',
  ROTATE = 'ROTATE'
}

export type KeyLoginChallenge = {
  challengeId: Scalars['ID']['output'];
  expiresAt: Scalars['DateTime']['output'];
  /** Copy into the `login` statement's `nonce`. */
  nonce: Scalars['String']['output'];
};

export type Keybind = {
  commandId: Scalars['String']['output'];
  context: KeybindContext;
  id: Scalars['ID']['output'];
  isEnabled: Scalars['Boolean']['output'];
  keystroke: Scalars['String']['output'];
  presetArgs?: Maybe<Scalars['JSON']['output']>;
  scope: KeybindScope;
  source: KeybindSource;
  workspaceId?: Maybe<Scalars['ID']['output']>;
};

export enum KeybindContext {
  COMMAND_PALETTE = 'COMMAND_PALETTE',
  COMPOSER = 'COMPOSER',
  CONVERSATION_VIEW = 'CONVERSATION_VIEW',
  GLOBAL = 'GLOBAL',
  MESSAGE_LIST = 'MESSAGE_LIST',
  PANEL = 'PANEL',
  THREAD_VIEW = 'THREAD_VIEW'
}

export enum KeybindScope {
  USER = 'USER',
  WORKSPACE = 'WORKSPACE'
}

export enum KeybindSource {
  DEFAULT = 'DEFAULT',
  USER = 'USER',
  WORKSPACE = 'WORKSPACE'
}

export type LinkPreview = {
  description?: Maybe<Scalars['String']['output']>;
  fetchedAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  messageId: Scalars['ID']['output'];
  siteName?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type LoginInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type LoginPayload = {
  userId: Scalars['ID']['output'];
};

export type MacroDef = {
  aiCallable: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  intentSamples: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  nlDescription: Scalars['String']['output'];
  sensitivity: CommandSensitivity;
  serverId: Scalars['ID']['output'];
  steps: Array<MacroStep>;
  userId: Scalars['ID']['output'];
};

export type MacroStep = {
  args?: Maybe<Scalars['JSON']['output']>;
  commandId: Scalars['String']['output'];
};

export type MacroStepInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandId: Scalars['String']['input'];
};

export type MarkAllAsReadInput = {
  workspaceId: Scalars['ID']['input'];
};

export type MarkAsReadInput = {
  conversationId: Scalars['ID']['input'];
  readAt: Scalars['DateTime']['input'];
  workspaceId: Scalars['ID']['input'];
};

/** A member's timeout: until `until` they can read but not write in the workspace. */
export type MemberTimeout = {
  createdAt: Scalars['DateTime']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  serverId: Scalars['ID']['output'];
  setBy?: Maybe<Scalars['ID']['output']>;
  until: Scalars['DateTime']['output'];
  userId: Scalars['ID']['output'];
};

export type Message = {
  attachments: Array<Attachment>;
  author?: Maybe<User>;
  authorId: Scalars['ID']['output'];
  conversationId: Scalars['ID']['output'];
  /**
   * The MLS envelope of an encrypted message, whose `text` is always null; null for
   * plaintext messages.
   */
  encryption?: Maybe<MessageEncryption>;
  forwardedFrom?: Maybe<Message>;
  forwardedFromMessageId?: Maybe<Scalars['ID']['output']>;
  hasAttachments: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isDeleted: Scalars['Boolean']['output'];
  isPinned: Scalars['Boolean']['output'];
  linkPreviews: Array<LinkPreview>;
  mentionedUserIds: Array<Scalars['ID']['output']>;
  mentions: Array<User>;
  parentMessageId?: Maybe<Scalars['ID']['output']>;
  reactions: Array<ReactionGroup>;
  rootThreadId?: Maybe<Scalars['ID']['output']>;
  sentAt: Scalars['DateTime']['output'];
  serverId: Scalars['ID']['output'];
  text?: Maybe<Scalars['String']['output']>;
  threadId?: Maybe<Scalars['ID']['output']>;
};

/** A message as it is now, at its newest change. A message appears at most once per page. */
export type MessageChange = {
  /** When the text last changed; null for a never-edited message. */
  editedAt?: Maybe<Scalars['DateTime']['output']>;
  kind: MessageChangeKind;
  /** The message. Deleted messages come back with `isDeleted: true` and null `text`. */
  message: Message;
  /**
   * The message's position in its conversation's change sequence, as a decimal string.
   * Increases with every change; compare it to a cached copy to keep the newer one.
   */
  version: Scalars['String']['output'];
};

/** One conversation to read in `messageChanges`, with the cursor the client stored for it. */
export type MessageChangeCursorInput = {
  /**
   * The `cursor` a previous `messageChanges` call returned for this conversation. Opaque.
   * Omit (or pass null) to read the conversation's whole history from the beginning.
   */
  after?: InputMaybe<Scalars['String']['input']>;
  conversationId: Scalars['ID']['input'];
};

/**
 * What happened to a message, judged from its state at its newest change. `DELETED` wins over
 * `EDITED`; a message whose text never changed is `CREATED`.
 */
export enum MessageChangeKind {
  CREATED = 'CREATED',
  DELETED = 'DELETED',
  EDITED = 'EDITED'
}

/** Input for `messageChanges`. */
export type MessageChangesInput = {
  /** At most 100 conversations. One the caller cannot read comes back with status `NO_ACCESS`. */
  conversations: Array<MessageChangeCursorInput>;
  /** Maximum changes per conversation. Clamped to 1..=200; defaults to 100. */
  limit?: InputMaybe<Scalars['Int']['input']>;
  serverId: Scalars['ID']['input'];
};

export type MessageCursorInput = {
  messageId: Scalars['ID']['input'];
  sentAt: Scalars['DateTime']['input'];
};

export type MessageCursorOutput = {
  messageId: Scalars['ID']['output'];
  sentAt: Scalars['DateTime']['output'];
};

/** The MLS envelope of an encrypted message. */
export type MessageEncryption = {
  /** The `MLSMessage`; null once the message is deleted. */
  ciphertext?: Maybe<Scalars['String']['output']>;
  /** The epoch the message was sent in. */
  epoch: Scalars['Int']['output'];
  frankingKeyId: Scalars['Int']['output'];
  frankingReceipt: Scalars['String']['output'];
  incarnation: Scalars['Int']['output'];
  senderDeviceId: Scalars['ID']['output'];
  /** `sentAt` in microseconds since the Unix epoch, as decimal text, as the receipt covers it. */
  sentAtUs: Scalars['String']['output'];
};

export type MessagePage = {
  items: Array<Message>;
  next?: Maybe<MessageCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<MessageCursorOutput>;
};

/**
 * A member's report of a message. `messageText` and `messageAuthorId` are present only when
 * the viewing moderator can read the conversation (`messageReadable`); otherwise only the ids
 * and the reporter's reason are shown. `messageText` is also null for a deleted message.
 *
 * A report of an encrypted message is franked: the server verified that its content is what
 * the sender's device sent (`frankingVerifiedAt`). Its author, send time and sender device are
 * shown to every moderator; its content (`frankedContent`) only by `messageReport`.
 */
export type MessageReport = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  /**
   * The exact content bytes of a verified report, unpadded base64url. Only `messageReport`
   * fills it; null in lists and once retention cleared it.
   */
  frankedContent?: Maybe<Scalars['String']['output']>;
  /**
   * When the verified content is deleted: 90 days after the report was resolved or
   * dismissed; null while it is open.
   */
  frankedContentExpiresAt?: Maybe<Scalars['DateTime']['output']>;
  /** The client device id that sent the reported encrypted message. */
  frankedSenderDeviceId?: Maybe<Scalars['ID']['output']>;
  /** Set when the server verified a franked report of an encrypted message. */
  frankingVerifiedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  messageAuthorId?: Maybe<Scalars['ID']['output']>;
  messageId: Scalars['ID']['output'];
  messageReadable: Scalars['Boolean']['output'];
  /** When the reported message was sent; null when its details are not shown. */
  messageSentAt?: Maybe<Scalars['DateTime']['output']>;
  messageText?: Maybe<Scalars['String']['output']>;
  reason: Scalars['String']['output'];
  reporterUserId: Scalars['ID']['output'];
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  resolvedBy?: Maybe<Scalars['ID']['output']>;
  serverId: Scalars['ID']['output'];
  status: MessageReportStatus;
};

export type MessageReportCursorInput = {
  createdAt: Scalars['DateTime']['input'];
  reportId: Scalars['ID']['input'];
};

export type MessageReportCursorOutput = {
  createdAt: Scalars['DateTime']['output'];
  reportId: Scalars['ID']['output'];
};

/** Reports ordered `createdAt ASC, id ASC`, standard cursor semantics (`docs/pagination.md`). */
export type MessageReportPage = {
  items: Array<MessageReport>;
  next?: Maybe<MessageReportCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<MessageReportCursorOutput>;
};

export enum MessageReportStatus {
  DISMISSED = 'DISMISSED',
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED'
}

export type MlsCommit = {
  createdAt: Scalars['DateTime']['output'];
  /** The epoch the Commit was created in; the group moved to the next. */
  epoch: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  incarnation: Scalars['Int']['output'];
  message: Scalars['String']['output'];
  senderDeviceId?: Maybe<Scalars['ID']['output']>;
  senderPrincipalId?: Maybe<Scalars['String']['output']>;
};

export type MlsCommitPage = {
  commits: Array<MlsCommit>;
  hasMore: Scalars['Boolean']['output'];
};

export type MlsDevice = {
  addedEpoch: Scalars['Int']['output'];
  deviceId: Scalars['ID']['output'];
  principalId: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
};

export type MlsDeviceRefInput = {
  deviceId: Scalars['ID']['input'];
  principalId: Scalars['String']['input'];
};

/** A conversation's current MLS group and the changes it waits for. */
export type MlsGroup = {
  cipherSuite: Scalars['Int']['output'];
  devices: Array<MlsDevice>;
  /** The epoch the next Commit must be created in. */
  epoch: Scalars['Int']['output'];
  groupId: Scalars['String']['output'];
  incarnation: Scalars['Int']['output'];
  /** MLS-active devices of members that are not in the group yet. */
  pendingAdds: Array<MlsPendingDevice>;
  /**
   * Devices in the group that no longer belong: their member left, they were revoked, or
   * they uploaded no key package for 60 days.
   */
  pendingRemoves: Array<MlsDevice>;
  readdRequests: Array<MlsReaddRequest>;
};

/** What the session's device has stored for one cipher suite. */
export type MlsKeyPackageStatus = {
  /** Unclaimed one-time key packages that can still be handed out (valid for 14 more days). */
  available: Scalars['Int']['output'];
  cipherSuite: Scalars['Int']['output'];
  /** How often the last-resort key package was handed out; past 5 the device replaces it. */
  lastResortClaims: Scalars['Int']['output'];
  lastResortNotAfter?: Maybe<Scalars['DateTime']['output']>;
  /** The earliest expiry among the available one-time key packages. */
  oldestNotAfter?: Maybe<Scalars['DateTime']['output']>;
};

export type MlsPendingDevice = {
  deviceId: Scalars['ID']['output'];
  hasKeyPackage: Scalars['Boolean']['output'];
  principalId: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
};

export type MlsReaddRequest = {
  createdAt: Scalars['DateTime']['output'];
  deviceId: Scalars['ID']['output'];
  principalId: Scalars['String']['output'];
  /** The `mls-readd` statement as the device signed it. */
  request: SignedStatement;
};

export type MlsWelcome = {
  conversationId: Scalars['ID']['output'];
  /** The epoch the device joins at. */
  epoch: Scalars['Int']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  incarnation: Scalars['Int']['output'];
  message: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
};

export type Mutation = {
  /** Release the request's held items, let later ones flow, and add the sender as a contact. */
  acceptDmRequest: DmRequest;
  /** Acknowledge Welcomes of the session's device; answers how many were acknowledged now. */
  ackMlsWelcomes: Scalars['Int']['output'];
  /** Move the session device's cursor up to `upTo`. */
  ackRelayItems: Scalars['Boolean']['output'];
  /** Add a contact, or replace its relay URLs (1 to 8 of at most 256 bytes each). */
  addContact: Contact;
  /** Add (invite) workspace members to a channel or group the caller belongs to. */
  addConversationMembers: Conversation;
  /** Add a device certified by the current identity key. */
  addDeviceKey: DeviceKey;
  /** Add the statement's plugin to the workspace's registry. Owner or Moderator. */
  addWorkspacePlugin: WorkspacePlugin;
  /**
   * Apply a device revocation on this host directly, as an app does when a host did not
   * acknowledge it through the relay. Needs no session: it acts only on the revocation's
   * signature, and attempts are limited per IP. Returns the host's signed acknowledgement.
   */
  applyRemoteRevocation: SignedStatement;
  /**
   * Remove a member and block them from re-joining until `expiresAt` (or until unbanned
   * when omitted). Same targeting rules as `kickMember`. Audited.
   */
  banMember: ServerBan;
  /** Ignore a principal's pending requests and refuse its invites and key package claims. */
  blockPrincipal: Scalars['Boolean']['output'];
  /** Cancel a link from either device, with or without a session. */
  cancelDeviceLink: Scalars['Boolean']['output'];
  /** One key package per device waiting to be added; devices with none usable are left out. */
  claimMlsKeyPackages: Array<ClaimedKeyPackage>;
  /** End a member's timeout early. Returns whether one was in force. Audited. */
  clearTimeout: Scalars['Boolean']['output'];
  /** Called by the new device right after its first `loginWithKey`. */
  completeDeviceLink: Scalars['Boolean']['output'];
  createAttachment: UploadTicket;
  createChannelLens: ChannelLens;
  createConversation: Conversation;
  createCustomEmoji: CustomEmoji;
  createInvite: CreateInvitePayload;
  createKeybind: Keybind;
  createMacro: MacroDef;
  createPipeline: PipelineGql;
  createServer: Server;
  createUserCommand: Command;
  deleteAttachment: Scalars['Boolean']['output'];
  deleteChannelLens: Scalars['Boolean']['output'];
  deleteCustomEmoji: Scalars['Boolean']['output'];
  deleteKeybind: Scalars['Boolean']['output'];
  deleteMacro: Scalars['Boolean']['output'];
  deleteMessage: Scalars['Boolean']['output'];
  deletePipeline: Scalars['Boolean']['output'];
  deleteUserCommand: Scalars['Boolean']['output'];
  deleteWorkspaceState: Scalars['Boolean']['output'];
  /** A new envelope carrying an encrypted message's complete new content. */
  editEncryptedMessage: Message;
  editMessage: Message;
  /** Bind a key identity to the signed-in account. Afterwards the password no longer signs in. */
  enrollIdentityKey: KeyIdentity;
  executeCommand: CommandResult;
  executeMacro: CommandResult;
  finalizeAttachment: Attachment;
  forwardMessage: Message;
  heartbeat: Scalars['Boolean']['output'];
  /** Delete the request's held items and drop later items of the conversation. */
  ignoreDmRequest: DmRequest;
  /** Join a public, unarchived channel. Idempotent. */
  joinChannel: Conversation;
  /**
   * Join a workspace on another host: the relay presents the caller's identity, proof and
   * delegation, and records the subscription.
   */
  joinRemoteWorkspace: RemoteJoinResult;
  joinServerByInvite: JoinServerByInvitePayload;
  /** Start a key login: a single-use challenge for a device to sign. No session needed. */
  keyLoginChallenge: KeyLoginChallenge;
  /**
   * Remove a member from the workspace (Owner/Moderator; nobody can kick the owner, and a
   * moderator cannot kick a moderator). They may re-join with a new invite. Audited.
   */
  kickMember: Scalars['Boolean']['output'];
  /** Leave a channel or group (not a DM). */
  leaveConversation: Scalars['Boolean']['output'];
  /**
   * Cancel the caller's subscriptions at every host, then delete their queue, requests,
   * contacts and blocks on this relay.
   */
  leaveRelay: Scalars['Boolean']['output'];
  login: LoginPayload;
  /**
   * Sign in with a `login` statement signed by an enrolled device key. Sets the same session
   * cookie as `login`.
   */
  loginWithKey: LoginPayload;
  logout: Scalars['Boolean']['output'];
  /** End every session of the signed-in account except this one. Returns how many ended. */
  logoutOtherSessions: Scalars['Int']['output'];
  markAllAsRead: Scalars['Boolean']['output'];
  markAsRead: Scalars['Boolean']['output'];
  /**
   * Mark the viewer's notifications read: the given `ids`, or every notification created at
   * or before `allBefore` (exactly one of the two). Returns how many changed.
   */
  markNotificationsRead: Scalars['Int']['output'];
  muteConversation: Scalars['Boolean']['output'];
  pinMessage: Scalars['Boolean']['output'];
  /** Publish a profile card signed by the current identity key. */
  publishProfileCard: ProfileCard;
  /**
   * Pin the host at `hostOrigin` as `hostServerId` and fetch a login challenge from it for a
   * join, with the workspace `inviteToken` names (the invite is not used).
   */
  remoteJoinChallenge: RemoteJoinChallenge;
  removeContact: Scalars['Boolean']['output'];
  /**
   * Remove a member from a channel or group: Owner/Moderator may remove anyone, others only
   * themselves.
   */
  removeConversationMember: Scalars['Boolean']['output'];
  /** Remove an entry from the workspace's registry. Owner or Moderator. */
  removeWorkspacePlugin: Scalars['Boolean']['output'];
  /**
   * Present fresh delegations of the caller's devices to their hosts; one entry per
   * delegation, in order.
   */
  renewDelegations: Array<RemoteSubscription>;
  replyToMessage: Message;
  /** Report a DM request as abuse; a pending one is ignored too. */
  reportDmRequest: Scalars['Boolean']['output'];
  /**
   * Report an encrypted message by revealing its content and franking key; the server checks
   * them against its receipt before the moderators see them.
   */
  reportEncryptedMessage: Scalars['Boolean']['output'];
  /**
   * Report a message to the workspace moderators. Any member who can read it, once per
   * message (`CONFLICT` on a second report). Audited (`chat.report_message`).
   */
  reportMessage: MessageReport;
  /** Ask the group's other devices to remove and add the session's device again. */
  requestMlsReadd: Scalars['Boolean']['output'];
  /**
   * `FEATURE_DISABLED` while the operator has disabled email. Without SMTP the reset mail is
   * logged instead of sent.
   */
  requestPasswordReset: Scalars['Boolean']['output'];
  resetPassword: Scalars['Boolean']['output'];
  /**
   * Close an open report as resolved or dismissed (Owner/Moderator). Audited
   * (`admin.resolve_report`).
   */
  resolveReport: MessageReport;
  /** Revoke a device, signed by the identity key or by the device itself. Ends its sessions. */
  revokeDeviceKey: DeviceKey;
  /**
   * Append a rotation to the key log. A rotation signed by the recovery key works without a
   * session, revokes every device and session, and enrolls the device given with it.
   */
  rotateIdentityKey: KeyIdentity;
  /**
   * The old device's sealed answer, carrying the new device's certificate. The link then
   * lives another 10 minutes.
   */
  sendDeviceLinkAnswer: DeviceLink;
  /** The new device's sealed offer. No session needed: the link id is the capability. */
  sendDeviceLinkOffer: Scalars['Boolean']['output'];
  /**
   * An encrypted message under a client-chosen id, in the group's current epoch. Sending
   * the same id and envelope again answers the stored message.
   */
  sendEncryptedMessage: Message;
  sendMessage: Message;
  /** Archive or unarchive a channel (Owner/Moderator). Archived channels are read-only. */
  setConversationArchived: Conversation;
  /**
   * Set the viewer's level for one conversation they can read; `level: null` goes back to
   * the workspace default. `muteConversation`/`unmuteConversation` keep working alongside.
   */
  setConversationNotificationLevel: ConversationNotificationLevel;
  /**
   * Turn the viewer's manual do-not-disturb pause on (until turned off, or until `until`)
   * or off. While paused, notifications are still recorded but arrive `quiet`.
   */
  setDoNotDisturb: NotificationSettings;
  /**
   * Change a member's role. Owner: any role but `OWNER`, never their own. Moderator:
   * `MEMBER` <-> `GUEST` only. Audited (`admin.set_member_role`).
   */
  setMemberRole: ServerMember;
  /**
   * Set a channel's slow mode, in seconds (0 to 21600; 0 turns it off). Owner/Moderator.
   * Audited (`chat.set_slow_mode`).
   */
  setSlowMode: Conversation;
  setWorkspaceState: WorkspaceStateEntryGql;
  /**
   * Unified signup mutation for all token-based and open-mode registration paths.
   *
   * In invite-only mode, exactly one of `instanceInviteToken` or `workspaceInviteToken`
   * must be supplied.
   * In open mode, all token fields must be absent.
   *
   * On success, sets session and CSRF cookies via `AuthIntent`.
   */
  signupWithInvite: SignupWithInvitePayloadGql;
  /**
   * Create an account from a key identity alone: no password, no email. The registration
   * mode applies as for `signupWithInvite` (exactly one token in invite-only mode, none in
   * open mode). Signs the new account in on the device that signed up, setting the same
   * session and CSRF cookies as `signupWithInvite`.
   */
  signupWithKey: SignupWithInvitePayloadGql;
  /**
   * Start linking a new device to the signed-in account. Cancels the account's previous
   * live link. The link lives 10 minutes.
   */
  startDeviceLink: StartedDeviceLink;
  startTyping: Scalars['Boolean']['output'];
  /**
   * A Commit for the group's current epoch, or an incarnation's first Commit (epoch 0).
   * `STALE_EPOCH` names the current incarnation and epoch when another Commit came first.
   */
  submitMlsCommit: MlsCommit;
  /**
   * Time a member out until `until` (at most 30 days ahead): they keep reading but every
   * write fails with `TIMED_OUT`. Same targeting rules as `kickMember`. Audited.
   */
  timeoutMember: MemberTimeout;
  togglePipeline: PipelineGql;
  toggleReaction: Array<ReactionGroup>;
  /** Lift a ban (Owner/Moderator). Returns whether a ban existed. Audited. */
  unbanMember: Scalars['Boolean']['output'];
  unblockPrincipal: Scalars['Boolean']['output'];
  unmuteConversation: Scalars['Boolean']['output'];
  unpinMessage: Scalars['Boolean']['output'];
  updateChannelLens: ChannelLens;
  updateConversationTopic: Conversation;
  updateKeybind: Keybind;
  updateMacro: MacroDef;
  /**
   * Update fields on the authenticated user's profile.
   *
   * Returns the full updated `User` so the client can refresh local cache
   * without an extra `me { ... }` round-trip.
   *
   * # Errors
   *
   * - `UNAUTHENTICATED` — no session.
   * - `FORBIDDEN` — `displayName` from a member whose relay is another server; their
   * display name comes from their profile card.
   * - `VALIDATION` — `displayName` > 64 chars, `statusText` > 256 chars,
   * `bio` > 2000 chars, or `avatarUrl` not under `/api/files/`.
   * - `NOT_FOUND` — caller's user row missing (should not happen in practice).
   * - `INTERNAL` — repository failure.
   *
   * # Examples
   *
   * ```graphql
   * mutation Update($input: UpdateMyProfileInput!) {
   * updateMyProfile(input: $input) {
   * id username displayName avatarUrl statusText bio
   * }
   * }
   * ```
   */
  updateMyProfile: User;
  /**
   * Replace the viewer's notification settings in the workspace (default level, keywords,
   * daily do-not-disturb window, digest). Keywords: at most 20, each 2 to 40 characters.
   */
  updateNotificationSettings: NotificationSettings;
  updatePipeline: PipelineGql;
  updateUserCommand: Command;
  /** Change an entry's statement, status or bundle URL. Owner or Moderator. */
  updateWorkspacePlugin: WorkspacePlugin;
  /**
   * Store key packages of the session's device, all or none. A last-resort package replaces
   * the device's previous one.
   */
  uploadMlsKeyPackages: MlsKeyPackageStatus;
};


export type MutationAcceptDmRequestArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAckMlsWelcomesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationAckRelayItemsArgs = {
  upTo: Scalars['ID']['input'];
};


export type MutationAddContactArgs = {
  principalId: Scalars['String']['input'];
  relayUrls: Array<Scalars['String']['input']>;
};


export type MutationAddConversationMembersArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  userIds: Array<Scalars['ID']['input']>;
};


export type MutationAddDeviceKeyArgs = {
  certificate: SignedStatementInput;
};


export type MutationAddWorkspacePluginArgs = {
  input: AddWorkspacePluginInput;
};


export type MutationApplyRemoteRevocationArgs = {
  revocation: SignedStatementInput;
};


export type MutationBanMemberArgs = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  reason?: InputMaybe<Scalars['String']['input']>;
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationBlockPrincipalArgs = {
  principalId: Scalars['String']['input'];
};


export type MutationCancelDeviceLinkArgs = {
  linkId: Scalars['String']['input'];
};


export type MutationClaimMlsKeyPackagesArgs = {
  input: ClaimMlsKeyPackagesInput;
};


export type MutationClearTimeoutArgs = {
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationCompleteDeviceLinkArgs = {
  linkId: Scalars['String']['input'];
};


export type MutationCreateAttachmentArgs = {
  input: CreateAttachmentInput;
};


export type MutationCreateChannelLensArgs = {
  input: CreateChannelLensInput;
};


export type MutationCreateConversationArgs = {
  input: CreateConversationInput;
};


export type MutationCreateCustomEmojiArgs = {
  input: CreateCustomEmojiInput;
};


export type MutationCreateInviteArgs = {
  input: CreateInviteInput;
};


export type MutationCreateKeybindArgs = {
  input: CreateKeybindInput;
};


export type MutationCreateMacroArgs = {
  input: CreateMacroInput;
};


export type MutationCreatePipelineArgs = {
  input: CreatePipelineInput;
};


export type MutationCreateServerArgs = {
  input: CreateServerInput;
};


export type MutationCreateUserCommandArgs = {
  input: CreateUserCommandInput;
};


export type MutationDeleteAttachmentArgs = {
  input: DeleteAttachmentInput;
};


export type MutationDeleteChannelLensArgs = {
  lensId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationDeleteCustomEmojiArgs = {
  emojiId: Scalars['ID']['input'];
};


export type MutationDeleteKeybindArgs = {
  input: DeleteKeybindInput;
};


export type MutationDeleteMacroArgs = {
  macroId: Scalars['ID']['input'];
};


export type MutationDeleteMessageArgs = {
  input: DeleteMessageInput;
};


export type MutationDeletePipelineArgs = {
  pipelineId: Scalars['ID']['input'];
};


export type MutationDeleteUserCommandArgs = {
  input: DeleteUserCommandInput;
};


export type MutationDeleteWorkspaceStateArgs = {
  input: DeleteWorkspaceStateInput;
};


export type MutationEditEncryptedMessageArgs = {
  input: EditEncryptedMessageInput;
};


export type MutationEditMessageArgs = {
  input: EditMessageInput;
};


export type MutationEnrollIdentityKeyArgs = {
  input: EnrollIdentityKeyInput;
};


export type MutationExecuteCommandArgs = {
  input: ExecuteCommandInput;
};


export type MutationExecuteMacroArgs = {
  input: ExecuteMacroInput;
};


export type MutationFinalizeAttachmentArgs = {
  input: FinalizeAttachmentInput;
};


export type MutationForwardMessageArgs = {
  input: ForwardMessageInput;
};


export type MutationHeartbeatArgs = {
  input: HeartbeatInput;
};


export type MutationIgnoreDmRequestArgs = {
  id: Scalars['ID']['input'];
};


export type MutationJoinChannelArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationJoinRemoteWorkspaceArgs = {
  input: JoinRemoteWorkspaceInput;
};


export type MutationJoinServerByInviteArgs = {
  input: JoinServerByInviteInput;
};


export type MutationKickMemberArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationLeaveConversationArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationLoginWithKeyArgs = {
  proof: SignedStatementInput;
};


export type MutationMarkAllAsReadArgs = {
  input: MarkAllAsReadInput;
};


export type MutationMarkAsReadArgs = {
  input: MarkAsReadInput;
};


export type MutationMarkNotificationsReadArgs = {
  allBefore?: InputMaybe<Scalars['DateTime']['input']>;
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
  serverId: Scalars['ID']['input'];
};


export type MutationMuteConversationArgs = {
  input: MuteConversationInput;
};


export type MutationPinMessageArgs = {
  input: PinMessageInput;
};


export type MutationPublishProfileCardArgs = {
  card: SignedStatementInput;
};


export type MutationRemoteJoinChallengeArgs = {
  hostOrigin: Scalars['String']['input'];
  hostServerId: Scalars['String']['input'];
  inviteToken?: InputMaybe<Scalars['String']['input']>;
};


export type MutationRemoveContactArgs = {
  principalId: Scalars['String']['input'];
};


export type MutationRemoveConversationMemberArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationRemoveWorkspacePluginArgs = {
  pluginId: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationRenewDelegationsArgs = {
  delegations: Array<SignedStatementInput>;
};


export type MutationReplyToMessageArgs = {
  input: ReplyToMessageInput;
};


export type MutationReportDmRequestArgs = {
  id: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


export type MutationReportEncryptedMessageArgs = {
  input: ReportEncryptedMessageInput;
};


export type MutationReportMessageArgs = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationRequestMlsReaddArgs = {
  input: RequestMlsReaddInput;
};


export type MutationRequestPasswordResetArgs = {
  username: Scalars['String']['input'];
};


export type MutationResetPasswordArgs = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};


export type MutationResolveReportArgs = {
  outcome: ReportOutcome;
  reportId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationRevokeDeviceKeyArgs = {
  revocation: SignedStatementInput;
};


export type MutationRotateIdentityKeyArgs = {
  input: RotateIdentityKeyInput;
};


export type MutationSendDeviceLinkAnswerArgs = {
  answer: SealedMessageInput;
  linkId: Scalars['String']['input'];
};


export type MutationSendDeviceLinkOfferArgs = {
  linkId: Scalars['String']['input'];
  offer: SealedMessageInput;
};


export type MutationSendEncryptedMessageArgs = {
  input: SendEncryptedMessageInput;
};


export type MutationSendMessageArgs = {
  input: SendMessageInput;
};


export type MutationSetConversationArchivedArgs = {
  archived: Scalars['Boolean']['input'];
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationSetConversationNotificationLevelArgs = {
  conversationId: Scalars['ID']['input'];
  level?: InputMaybe<NotificationLevel>;
  serverId: Scalars['ID']['input'];
};


export type MutationSetDoNotDisturbArgs = {
  paused: Scalars['Boolean']['input'];
  serverId: Scalars['ID']['input'];
  until?: InputMaybe<Scalars['DateTime']['input']>;
};


export type MutationSetMemberRoleArgs = {
  role: ServerMemberRoleGql;
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationSetSlowModeArgs = {
  conversationId: Scalars['ID']['input'];
  seconds: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationSetWorkspaceStateArgs = {
  input: SetWorkspaceStateInput;
};


export type MutationSignupWithInviteArgs = {
  input: SignupWithInviteInput;
};


export type MutationSignupWithKeyArgs = {
  input: SignupWithKeyInput;
};


export type MutationStartTypingArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationSubmitMlsCommitArgs = {
  input: SubmitMlsCommitInput;
};


export type MutationTimeoutMemberArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  serverId: Scalars['ID']['input'];
  until: Scalars['DateTime']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationTogglePipelineArgs = {
  enabled: Scalars['Boolean']['input'];
  pipelineId: Scalars['ID']['input'];
};


export type MutationToggleReactionArgs = {
  input: ToggleReactionInput;
};


export type MutationUnbanMemberArgs = {
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationUnblockPrincipalArgs = {
  principalId: Scalars['String']['input'];
};


export type MutationUnmuteConversationArgs = {
  input: UnmuteConversationInput;
};


export type MutationUnpinMessageArgs = {
  input: UnpinMessageInput;
};


export type MutationUpdateChannelLensArgs = {
  input: UpdateChannelLensInput;
};


export type MutationUpdateConversationTopicArgs = {
  input: UpdateConversationTopicInput;
};


export type MutationUpdateKeybindArgs = {
  input: UpdateKeybindInput;
};


export type MutationUpdateMacroArgs = {
  input: UpdateMacroInput;
};


export type MutationUpdateMyProfileArgs = {
  input: UpdateMyProfileInput;
};


export type MutationUpdateNotificationSettingsArgs = {
  input: UpdateNotificationSettingsInput;
  serverId: Scalars['ID']['input'];
};


export type MutationUpdatePipelineArgs = {
  input: UpdatePipelineInput;
};


export type MutationUpdateUserCommandArgs = {
  input: UpdateUserCommandInput;
};


export type MutationUpdateWorkspacePluginArgs = {
  input: UpdateWorkspacePluginInput;
};


export type MutationUploadMlsKeyPackagesArgs = {
  keyPackages: Array<Scalars['String']['input']>;
};

export type MuteConversationInput = {
  conversationId: Scalars['ID']['input'];
  mutedUntil?: InputMaybe<Scalars['DateTime']['input']>;
  serverId: Scalars['ID']['input'];
};

export type MutedConversation = {
  conversationId: Scalars['ID']['output'];
  mutedUntil?: Maybe<Scalars['DateTime']['output']>;
};

/** One entry of the viewer's notification inbox. */
export type Notification = {
  /** Null when the viewer can no longer read the conversation. */
  conversation?: Maybe<Conversation>;
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /**
   * The message (timeline or thread reply); null when the viewer can no longer read the
   * conversation or the message is gone.
   */
  message?: Maybe<Message>;
  messageId: Scalars['ID']['output'];
  readAt?: Maybe<Scalars['DateTime']['output']>;
  reason: NotificationReason;
  serverId: Scalars['ID']['output'];
};

export type NotificationCursorInput = {
  createdAt: Scalars['DateTime']['input'];
  notificationId: Scalars['ID']['input'];
};

export type NotificationCursorOutput = {
  createdAt: Scalars['DateTime']['output'];
  notificationId: Scalars['ID']['output'];
};

/** Which messages of a conversation notify the viewer. */
export enum NotificationLevel {
  /** Every message. */
  ALL = 'ALL',
  /**
   * Direct messages, mentions (`<@user>`, `@channel`, `@here`), keyword hits and replies in
   * the viewer's threads.
   */
  MENTIONS = 'MENTIONS',
  /** Nothing, mentions included. */
  NONE = 'NONE'
}

/**
 * Notifications ordered `createdAt DESC, id DESC` (newest first), standard cursor semantics
 * (`docs/pagination.md`): `AFTER` pages go to older notifications.
 */
export type NotificationPage = {
  items: Array<Notification>;
  next?: Maybe<NotificationCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<NotificationCursorOutput>;
};

/** Why the viewer was notified (the strongest reason that applied). */
export enum NotificationReason {
  ALL = 'ALL',
  DIRECT = 'DIRECT',
  KEYWORD = 'KEYWORD',
  MENTION = 'MENTION',
  THREAD_REPLY = 'THREAD_REPLY'
}

/** The viewer's notification settings in one workspace (defaults until first saved). */
export type NotificationSettings = {
  /** Applies to every conversation without its own level. */
  defaultLevel: NotificationLevel;
  digest: DigestFrequency;
  dnd?: Maybe<DndWindow>;
  /** The manual do-not-disturb pause (`setDoNotDisturb`, `notifications.dnd`). */
  dndPaused: Scalars['Boolean']['output'];
  /** When the manual pause ends; null while `dndPaused` is false or the pause has no end. */
  dndPausedUntil?: Maybe<Scalars['DateTime']['output']>;
  /** Lower-cased; a whole-word, case-insensitive hit notifies (level `MENTIONS` or `ALL`). */
  keywords: Array<Scalars['String']['output']>;
  serverId: Scalars['ID']['output'];
};

export enum PageDir {
  AFTER = 'AFTER',
  BEFORE = 'BEFORE'
}

export type PageInfo = {
  hasNext: Scalars['Boolean']['output'];
  hasPrev: Scalars['Boolean']['output'];
};

export type PinMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type PipeStageResult = {
  commandId: Scalars['String']['output'];
  message: Scalars['String']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
  stageIndex: Scalars['Int']['output'];
  status: CommandResultStatus;
};

export type PipelineActionGql = {
  actionType: Scalars['String']['output'];
  args?: Maybe<Scalars['JSON']['output']>;
  commandId?: Maybe<Scalars['String']['output']>;
};

export type PipelineActionInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandId: Scalars['String']['input'];
};

export type PipelineFilterConditionGql = {
  conditionType: Scalars['String']['output'];
  conversationId?: Maybe<Scalars['ID']['output']>;
  pattern?: Maybe<Scalars['String']['output']>;
  userId?: Maybe<Scalars['ID']['output']>;
};

export type PipelineFilterConditionInput = {
  conditionType: Scalars['String']['input'];
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  pattern?: InputMaybe<Scalars['String']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};

export type PipelineFilterGql = {
  conditions: Array<PipelineFilterConditionGql>;
};

export type PipelineFilterInput = {
  conditions: Array<PipelineFilterConditionInput>;
};

export type PipelineGql = {
  actions: Array<PipelineActionGql>;
  cooldownSecs?: Maybe<Scalars['Int']['output']>;
  createdAt: Scalars['DateTime']['output'];
  createdBy: Scalars['ID']['output'];
  description?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  filter?: Maybe<PipelineFilterGql>;
  id: Scalars['ID']['output'];
  lastFiredAt?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  schemaVersion: Scalars['Int']['output'];
  serverId: Scalars['ID']['output'];
  trigger: PipelineTriggerGql;
  updatedAt: Scalars['DateTime']['output'];
};

export type PipelineTriggerGql = {
  conversationId?: Maybe<Scalars['ID']['output']>;
  kind: PipelineTriggerKindGql;
};

export type PipelineTriggerInput = {
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  kind: PipelineTriggerKindGql;
};

export enum PipelineTriggerKindGql {
  MEMBER_JOINED = 'MEMBER_JOINED',
  MESSAGE_DELETED = 'MESSAGE_DELETED',
  MESSAGE_UPDATED = 'MESSAGE_UPDATED',
  NEW_MESSAGE = 'NEW_MESSAGE',
  REACTIONS_UPDATED = 'REACTIONS_UPDATED',
  WORKSPACE_STATE_CHANGED = 'WORKSPACE_STATE_CHANGED'
}

export enum PluginRuntimeKind {
  DESKTOP_LOCAL_PROCESS = 'DESKTOP_LOCAL_PROCESS',
  WEB_SANDBOXED = 'WEB_SANDBOXED'
}

export enum PluginSignatureStatus {
  /**
   * The publisher recovered their key after the statement's `keySeq`: clients refuse new
   * installs and updates of the entry.
   */
  PUBLISHER_RECOVERED = 'PUBLISHER_RECOVERED',
  VALID = 'VALID'
}

/**
 * Where an entry's code comes from: the bundle fields for `BUNDLE`, the git fields for `GIT`.
 * Hashes are lowercase hex.
 */
export type PluginSource = {
  bundleSha256?: Maybe<Scalars['String']['output']>;
  bundleSize?: Maybe<Scalars['Int']['output']>;
  /** Where to fetch the bundle. Not signed: the hash decides whether the bytes are right. */
  bundleUrl?: Maybe<Scalars['String']['output']>;
  gitCommit?: Maybe<Scalars['String']['output']>;
  gitTreeSha256?: Maybe<Scalars['String']['output']>;
  gitUrl?: Maybe<Scalars['String']['output']>;
  kind: PluginSourceKind;
};

export enum PluginSourceKind {
  BUNDLE = 'BUNDLE',
  GIT = 'GIT'
}

/** The conversation a successor replaces. */
export type PredecessorInput = {
  conversationId: Scalars['ID']['input'];
  hostServerId: Scalars['String']['input'];
};

export enum PresenceStatus {
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
  ONLINE = 'ONLINE'
}

/** A certified device of a principal, revoked or not. */
export type PrincipalDevice = {
  certificate: SignedStatement;
  deviceId: Scalars['ID']['output'];
  /**
   * Not revoked and uploaded key packages in the last 60 days: the device is set up for
   * encryption and belongs in its member's encrypted groups.
   */
  mlsActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  revocation?: Maybe<SignedStatement>;
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type PrincipalDevices = {
  devices: Array<PrincipalDevice>;
  principalId: Scalars['String']['output'];
};

export type ProfileCard = {
  statement: SignedStatement;
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type Query = {
  applyChannelLens: Array<Message>;
  channelLenses: Array<ChannelLens>;
  channels: ChannelPage;
  /**
   * P5-A7 — AI Agent command-discovery meta-tool (v2 §5 R1 #3, M6).
   *
   * Returns the actor's accessible AI-callable command surface, optionally
   * ranked by `intent_phrase` relevance (literal substring + token-overlap
   * against `intent_samples`, `title`, `nl_description`), truncated to
   * `limit` (default 50, hard-capped at 100), and scoped to a workspace for
   * macro synthesis.
   *
   * Rate-limited: 5 calls / 60-second sliding window per actor (M6).
   * Returns `RATE_LIMITED` on overage.
   */
  commandDiscover: Array<Command>;
  commands: Array<Command>;
  /** The caller's contacts, oldest first. */
  contacts: Array<Contact>;
  conversation: Conversation;
  customEmojis: Array<CustomEmoji>;
  /**
   * One of the signed-in account's device links: its state, expiry and, once the new device
   * sent it, the sealed offer.
   */
  deviceLink: DeviceLink;
  /**
   * The sealed answer for the new device, `null` until the old device sends it. No session
   * needed: the link id is the capability.
   */
  deviceLinkAnswer?: Maybe<SealedMessage>;
  /** Where the revocation of one of the caller's devices stands at each host holding them. */
  deviceRevocationStatus: Array<RevocationFanout>;
  /** The caller's DM requests, newest first. */
  dmRequests: Array<DmRequest>;
  inboxConversations: ConversationPage;
  /**
   * The public key log of a principal enrolled on this server, oldest first; empty when none
   * is. No session needed: a person who lost every device reads the head here to sign a
   * recovery rotation (`rotateIdentityKey`).
   */
  keyLog: Array<KeyLogEntry>;
  /** Query the command audit log. Requires `audit.read` capability. */
  listAuditLog: AuditLogPage;
  macroByName?: Maybe<MacroDef>;
  me: User;
  message: Message;
  /**
   * The message change feed: for each conversation, the messages created, edited or deleted
   * after its cursor (timeline and thread replies alike), oldest change first. A client cache
   * stores each returned `cursor` and passes it back as `after`. Contract (frozen):
   * `docs/message-change-feed.md`.
   */
  messageChanges: Array<ConversationMessageChanges>;
  /**
   * One report of the workspace. Owner/Moderator only. For a verified report of an
   * encrypted message it includes `frankedContent`, and records that the moderator viewed
   * it (`e2ee.report_viewed`).
   */
  messageReport: MessageReport;
  /**
   * Message reports of the workspace (all statuses when `status` is omitted), ordered
   * `createdAt ASC, id ASC`. Owner/Moderator only. The message body is included only when
   * the moderator can read the conversation.
   */
  messageReports: MessageReportPage;
  messages: MessagePage;
  /**
   * Accepted Commits of an incarnation after `afterEpoch` (exclusive; from 0 when null),
   * oldest first. `limit` is 1 to 100, 50 by default.
   */
  mlsCommits: MlsCommitPage;
  mutedConversations: Array<MutedConversation>;
  /** The signed-in account's key log, devices and profile card on this server. */
  myKeyIdentity: KeyIdentity;
  myMacros: Array<MacroDef>;
  /** The session device's stored key packages, per cipher suite. */
  myMlsKeyPackageStatus: Array<MlsKeyPackageStatus>;
  /** The session device's unacknowledged Welcomes, oldest first. */
  myMlsWelcomes: Array<MlsWelcome>;
  /** The viewer's notification settings in the workspace (defaults until first saved). */
  myNotificationSettings: NotificationSettings;
  /**
   * The viewer's notifications in the workspace, newest first (`createdAt DESC, id DESC`).
   * `AFTER` pages go to older notifications. Defaults: `unreadOnly` false, `dir` `AFTER`,
   * `limit` 50 (clamped to 1..=100).
   */
  myNotifications: NotificationPage;
  myServers: Array<Server>;
  /** Unread notifications of the viewer in the workspace (the bell badge). */
  myUnreadNotificationCount: Scalars['Int']['output'];
  pinnedMessages: Array<Message>;
  pipelines: Array<PipelineGql>;
  /**
   * Preview a registration token without consuming it.
   *
   * Returns minimal metadata so the frontend can render the correct signup
   * copy before the user submits credentials. Rate-limited at 30 req / 5 min
   * per IP; no authentication required.
   *
   * See spec §4.7.
   */
  previewInviteToken: InviteTokenPreviewGql;
  /**
   * The certified devices of principals who share a workspace with the caller (the direct
   * space included); an empty list for any other principal. At most 100 ids.
   */
  principalDevices: Array<PrincipalDevices>;
  /**
   * Return the deployment-wide registration mode.
   *
   * Used by the login page to decide whether to render a "Sign up" link.
   * No authentication required — this is public configuration metadata.
   */
  registrationMode: RegistrationModeGql;
  /** This server's id, roles and direct space. Readable without a session. */
  relayInfo: RelayInfo;
  /**
   * The session device's queued host events above `after` (its cursor when omitted).
   * `limit` is 1 to 500, 200 by default.
   */
  relayItems: RelayItemPage;
  /**
   * A principal's identity: a local one directly, else fetched from `relayUrl` (pinning it)
   * and cached for 24 hours.
   */
  remoteIdentity: RemoteIdentity;
  /** Pin the server at `origin` through this relay and return its discovery document. */
  remoteServer: RemoteServer;
  /** The caller's subscriptions to workspaces on other hosts. */
  remoteSubscriptions: Array<RemoteSubscription>;
  resolvedKeybinds: Array<Keybind>;
  /**
   * Full-text search over messages. Supports the `from:`/`in:`/`has:`/`before:`/`after:`
   * operator syntax in `input.query` — see `docs/search.md`.
   *
   * **Breaking change (Track B1):** this replaced a flat, unpaginated `[SearchResultMessage!]!`
   * return with top-level `limit`/`includeDeleted` args. It now takes a single
   * `SearchMessagesInput` and returns a cursor-paginated `SearchResultPage`. Frontend codegen
   * must be re-run against the updated schema.
   *
   * **Why cursor-paginated by recency, not relevance:** results are ordered `(sentAt, id)` —
   * the same contract as every other message list (`docs/pagination.md`) — rather than by
   * `SearchResultMessage.rank`. `ts_rank` is neither unique nor stable across concurrent
   * inserts, so paginating by it would produce skips/duplicates across pages. `rank` and
   * `headline` are still returned on every item for client-side display or a page-local sort.
   * See `docs/search.md` for the full rationale.
   */
  searchMessages: SearchResultPage;
  server: Server;
  /** Active bans of the workspace, newest first. Owner/Moderator only. */
  serverBans: Array<ServerBan>;
  /** The server's release version, API version and features. Readable without a session. */
  serverInfo: ServerInfo;
  serverMembers: Array<ServerMember>;
  /**
   * The current `seq` of each named event stream of a space hosted here that the caller can
   * see; streams the caller cannot see are left out.
   */
  streamHeads: Array<StreamHead>;
  thread: Thread;
  threadByRootMessage?: Maybe<Thread>;
  threadMessages: MessagePage;
  unreadCounts: Array<UnreadCount>;
  /** The workspace's plugin registry, ordered by plugin id. Any member, guests included. */
  workspacePlugins: Array<WorkspacePlugin>;
  workspacePresence: Array<UserPresenceGql>;
  workspaceState?: Maybe<WorkspaceStateEntryGql>;
  workspaceStateList: Array<WorkspaceStateEntryGql>;
};


export type QueryApplyChannelLensArgs = {
  conversationId: Scalars['ID']['input'];
  lensId: Scalars['ID']['input'];
  limit?: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryChannelLensesArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryChannelsArgs = {
  cursor?: InputMaybe<ChannelCursorInput>;
  dir: PageDir;
  filter?: InputMaybe<ChannelListFilter>;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryCommandDiscoverArgs = {
  intentPhrase?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryCommandsArgs = {
  commandContext?: InputMaybe<CommandContextInput>;
  surface?: InputMaybe<CommandSurface>;
};


export type QueryConversationArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryCustomEmojisArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryDeviceLinkArgs = {
  linkId: Scalars['String']['input'];
};


export type QueryDeviceLinkAnswerArgs = {
  linkId: Scalars['String']['input'];
};


export type QueryDeviceRevocationStatusArgs = {
  deviceId: Scalars['ID']['input'];
};


export type QueryDmRequestsArgs = {
  status?: InputMaybe<DmRequestStatus>;
};


export type QueryInboxConversationsArgs = {
  cursor?: InputMaybe<InboxCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryKeyLogArgs = {
  principalId: Scalars['String']['input'];
};


export type QueryListAuditLogArgs = {
  filter?: InputMaybe<AuditLogFilterInput>;
  pagination?: InputMaybe<AuditLogPaginationInput>;
};


export type QueryMacroByNameArgs = {
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryMessageArgs = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryMessageChangesArgs = {
  input: MessageChangesInput;
};


export type QueryMessageReportArgs = {
  reportId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryMessageReportsArgs = {
  cursor?: InputMaybe<MessageReportCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
  status?: InputMaybe<MessageReportStatus>;
};


export type QueryMessagesArgs = {
  conversationId: Scalars['ID']['input'];
  cursor?: InputMaybe<MessageCursorInput>;
  dir: PageDir;
  includeDeleted: Scalars['Boolean']['input'];
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryMlsCommitsArgs = {
  afterEpoch?: InputMaybe<Scalars['Int']['input']>;
  conversationId: Scalars['ID']['input'];
  incarnation: Scalars['Int']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  serverId: Scalars['ID']['input'];
};


export type QueryMutedConversationsArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyMacrosArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyNotificationSettingsArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyNotificationsArgs = {
  cursor?: InputMaybe<NotificationCursorInput>;
  dir?: InputMaybe<PageDir>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  serverId: Scalars['ID']['input'];
  unreadOnly?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryMyUnreadNotificationCountArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryPinnedMessagesArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryPipelinesArgs = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  serverId: Scalars['ID']['input'];
};


export type QueryPreviewInviteTokenArgs = {
  token: Scalars['String']['input'];
};


export type QueryPrincipalDevicesArgs = {
  principalIds: Array<Scalars['String']['input']>;
};


export type QueryRelayItemsArgs = {
  after?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryRemoteIdentityArgs = {
  principalId: Scalars['String']['input'];
  relayUrl?: InputMaybe<Scalars['String']['input']>;
};


export type QueryRemoteServerArgs = {
  origin: Scalars['String']['input'];
};


export type QueryResolvedKeybindsArgs = {
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySearchMessagesArgs = {
  input: SearchMessagesInput;
};


export type QueryServerArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerBansArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerMembersArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryStreamHeadsArgs = {
  serverId: Scalars['ID']['input'];
  streams: Array<Scalars['String']['input']>;
};


export type QueryThreadArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type QueryThreadByRootMessageArgs = {
  conversationId: Scalars['ID']['input'];
  rootMessageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryThreadMessagesArgs = {
  conversationId: Scalars['ID']['input'];
  cursor?: InputMaybe<MessageCursorInput>;
  dir: PageDir;
  includeDeleted: Scalars['Boolean']['input'];
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type QueryUnreadCountsArgs = {
  workspaceId: Scalars['ID']['input'];
};


export type QueryWorkspacePluginsArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryWorkspacePresenceArgs = {
  workspaceId: Scalars['ID']['input'];
};


export type QueryWorkspaceStateArgs = {
  key: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
};


export type QueryWorkspaceStateListArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  prefix: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
};

export type ReactionGroup = {
  count: Scalars['Int']['output'];
  emoji: Scalars['String']['output'];
  reactedByMe: Scalars['Boolean']['output'];
  userIds: Array<Scalars['ID']['output']>;
};

/**
 * GraphQL enum for the deployment-wide registration mode.
 *
 * Mirrors [`rim_services::auth::dto::RegistrationMode`].
 * Variants appear in the SDL as `INVITE_ONLY`, `OPEN` and `POW`.
 */
export enum RegistrationModeGql {
  /** Default: signup requires a valid token (instance or workspace invite). */
  INVITE_ONLY = 'INVITE_ONLY',
  /** `RIM_OPEN_REGISTRATION=true`: signup accepts no token; rate-limited. */
  OPEN = 'OPEN',
  /**
   * `RIM_REGISTRATION_POW_BITS`: `signupWithKey` takes a token or a proof-of-work whose
   * difficulty the discovery document's `registration.powBits` gives; a password signup
   * takes a token.
   */
  POW = 'POW'
}

/** This server as its users' relay. */
export type RelayInfo = {
  /** The space holding the DMs and groups this relay's users start with anyone. */
  directSpaceId: Scalars['ID']['output'];
  /** `host`, `relay` or both. */
  roles: Array<Scalars['String']['output']>;
  /** This server's id (`rims1_…`). */
  serverId: Scalars['String']['output'];
};

/** A host event queued for the caller, signed by its host. */
export type RelayItem = {
  envelope: SignedStatement;
  hostServerId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  workspaceId: Scalars['ID']['output'];
};

export type RelayItemPage = {
  hasMore: Scalars['Boolean']['output'];
  items: Array<RelayItem>;
};

/**
 * A principal's identity as their relay serves it. The app verifies the log against the
 * principal id, each certificate against the log and the card against the head.
 */
export type RemoteIdentity = {
  card?: Maybe<SignedStatement>;
  devices: Array<RemotePrincipalDevice>;
  keyLog: Array<SignedStatement>;
  principalId: Scalars['String']['output'];
  /** Server id of the relay that served it. */
  servedBy: Scalars['String']['output'];
};

/**
 * A login challenge from a host, fetched through the relay, for a device to sign with the
 * host's server id as `audience`.
 */
export type RemoteJoinChallenge = {
  challengeId: Scalars['ID']['output'];
  expiresAt: Scalars['DateTime']['output'];
  nonce: Scalars['String']['output'];
  /** The workspace the invite names, for the delegation; null without an invite. */
  workspaceId?: Maybe<Scalars['ID']['output']>;
};

/** A workspace joined on another host. */
export type RemoteJoinResult = {
  hostServerId: Scalars['String']['output'];
  /** `owner`, `moderator`, `member` or `guest`. */
  role: Scalars['String']['output'];
  /** The member's user id at the host. */
  userId: Scalars['ID']['output'];
  workspaceId: Scalars['ID']['output'];
};

/** Someone from another server to start a conversation with. */
export type RemoteMemberInput = {
  principalId: Scalars['String']['input'];
  /** Their relays, tried in order to fetch their identity. */
  relayUrls: Array<Scalars['String']['input']>;
};

/** A device of a principal from another server. */
export type RemotePrincipalDevice = {
  certificate: SignedStatement;
  deviceId: Scalars['ID']['output'];
  /** Whether the device uploaded key packages recently enough to be added to groups. */
  mlsActive: Scalars['Boolean']['output'];
  revocation?: Maybe<SignedStatement>;
};

/** Another server, pinned through this relay. */
export type RemoteServer = {
  /** The discovery document as JSON text, for the app to verify and pin. */
  discovery: Scalars['String']['output'];
  origin: Scalars['String']['output'];
  serverId: Scalars['String']['output'];
};

/** The relay's subscription to a workspace on another host, or a delegation the host refused. */
export type RemoteSubscription = {
  /** When the host stops honouring the delegation that keeps it active. */
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  hostServerId: Scalars['String']['output'];
  /** Why a delegation was refused (`not_member`, `expired`, `relay_key`, …). */
  reason?: Maybe<Scalars['String']['output']>;
  /** `active`, `lapsed` or `ended`; `refused` for a delegation the host did not accept. */
  status: Scalars['String']['output'];
  workspaceId: Scalars['ID']['output'];
};

export type ReplyToMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  rootMessageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type ReportEncryptedMessageInput = {
  /** The decrypted content, exactly as committed to. */
  content: Scalars['String']['input'];
  conversationId: Scalars['ID']['input'];
  frankingKey: Scalars['String']['input'];
  messageId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  receipt: Scalars['String']['input'];
  receiptKeyId: Scalars['Int']['input'];
  senderDeviceId: Scalars['ID']['input'];
  senderUserId: Scalars['ID']['input'];
  /** Decimal microseconds. */
  sentAtUs: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};

/** How a moderator closes a report. */
export enum ReportOutcome {
  DISMISSED = 'DISMISSED',
  RESOLVED = 'RESOLVED'
}

export type RequestMlsReaddInput = {
  conversationId: Scalars['ID']['input'];
  /** The `mls-readd` statement, signed by the session's device key. */
  request: SignedStatementInput;
  serverId: Scalars['ID']['input'];
};

/** A device revocation at one host. */
export type RevocationFanout = {
  /** The host's signed `revocation-ack`, checked against its key. */
  ack?: Maybe<SignedStatement>;
  attempts: Scalars['Int']['output'];
  hostServerId: Scalars['String']['output'];
  status: RevocationFanoutStatus;
};

/** Where a revocation's delivery to one host stands. */
export enum RevocationFanoutStatus {
  ACKED = 'ACKED',
  GAVE_UP = 'GAVE_UP',
  PENDING = 'PENDING'
}

export type RotateIdentityKeyInput = {
  /** Device certificate under the new identity key. Required for a recovery rotation. */
  device?: InputMaybe<SignedStatementInput>;
  entry: SignedStatementInput;
};

/** A sealed message exactly as it was sent. */
export type SealedMessage = {
  ciphertext: Scalars['String']['output'];
  nonce: Scalars['String']['output'];
};

/**
 * A sealed offer or answer: the 12-byte nonce and the AES-GCM ciphertext with its 16-byte tag
 * appended, both unpadded base64url. The server checks only the encoding and the size.
 */
export type SealedMessageInput = {
  ciphertext: Scalars['String']['input'];
  nonce: Scalars['String']['input'];
};

/**
 * Input for the `searchMessages` full-text-search query. See `docs/search.md` for the
 * `from:`/`in:`/`has:`/`before:`/`after:` operator syntax accepted in `query`.
 */
export type SearchMessagesInput = {
  /** Optional explicit single-conversation scope, in addition to the `in:` search operator. */
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  cursor?: InputMaybe<MessageCursorInput>;
  /** Defaults to `AFTER` (most-recent-first) if omitted. */
  dir?: InputMaybe<PageDir>;
  /** Clamped server-side; defaults to 25 if omitted. */
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};

export type SearchResultMessage = {
  author?: Maybe<User>;
  authorId: Scalars['ID']['output'];
  conversationId: Scalars['ID']['output'];
  conversationTitle?: Maybe<Scalars['String']['output']>;
  conversationType: ConversationTypeEnum;
  /**
   * `ts_headline` snippet with `<mark>...</mark>` highlights around matched terms. `None` when
   * the query had no free-text component (a purely operator-based search, e.g. `from:@alice`).
   */
  headline?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /**
   * `ts_rank` relevance score. Informational / for client-side secondary sort — results are
   * paginated by recency (`sentAt`, `id`), not by rank. See `docs/search.md`.
   */
  rank: Scalars['Float']['output'];
  rootMessageId?: Maybe<Scalars['ID']['output']>;
  sentAt: Scalars['DateTime']['output'];
  serverId: Scalars['ID']['output'];
  text?: Maybe<Scalars['String']['output']>;
  threadId?: Maybe<Scalars['ID']['output']>;
};

/**
 * Cursor-paginated `searchMessages` result. Mirrors [`MessagePage`] — same `(sentAt, messageId)`
 * cursor contract — because search results are paginated by recency, not relevance; see the
 * `rank` field on [`SearchResultMessage`] and `docs/search.md` for why.
 */
export type SearchResultPage = {
  items: Array<SearchResultMessage>;
  next?: Maybe<MessageCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<MessageCursorOutput>;
};

export type SendEncryptedMessageInput = {
  conversationId: Scalars['ID']['input'];
  envelope: Scalars['String']['input'];
  forwardedFromMessageId?: InputMaybe<Scalars['ID']['input']>;
  /** Chosen by the client (UUID v7). */
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  threadRootMessageId?: InputMaybe<Scalars['ID']['input']>;
};

export type SendMessageInput = {
  conversationId: Scalars['ID']['input'];
  /**
   * The message this one forwards by sending its content again (an encrypted message's
   * content, after the person confirmed it is posted unencrypted). The caller must be able
   * to read it.
   */
  forwardedFromMessageId?: InputMaybe<Scalars['ID']['input']>;
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type Server = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /**
   * The requesting actor's effective role in this server. **Display/affordance signal
   * only — not an authorization boundary.** Every mutation independently re-checks the
   * role server-side (defense in depth); this field just lets the client avoid rendering
   * controls the viewer can't use. Non-null: every viewer who can query a `Server` is
   * necessarily a member of it (query-level visibility already guards non-members), so
   * there is no "not a member" variant to represent here.
   */
  viewerRole: ServerMemberRoleGql;
};

/** A workspace ban. Active bans block every way of joining the workspace. */
export type ServerBan = {
  bannedBy?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Null for a ban that lasts until it is lifted. */
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  serverId: Scalars['ID']['output'];
  /** The banned user (null if the account no longer exists). */
  user?: Maybe<User>;
  userId: Scalars['ID']['output'];
};

/** One optional feature and whether it works here. */
export type ServerFeatureInfo = {
  /**
   * The feature's name, as `RIM_FEATURES_DISABLED` takes it: `attachments`, `link_previews`,
   * `email`, `custom_emoji`, `workspace_plugins` or `ai_commands`. A client ignores a name
   * it does not know.
   */
  key: Scalars['String']['output'];
  /** Why an unavailable feature is unavailable; null otherwise. */
  reason?: Maybe<Scalars['String']['output']>;
  state: ServerFeatureState;
};

/** Whether an optional feature works on this instance. */
export enum ServerFeatureState {
  /** The operator switched it off. */
  DISABLED = 'DISABLED',
  /** The feature works. */
  ENABLED = 'ENABLED',
  /** The configuration lacks something the feature needs; `reason` says what. */
  UNAVAILABLE = 'UNAVAILABLE'
}

/** The running server build, the API version it speaks and the optional features it runs. */
export type ServerInfo = {
  /** The major version of this GraphQL API. */
  apiVersion: Scalars['Int']['output'];
  /** Every optional feature with its state on this instance. */
  features: Array<ServerFeatureInfo>;
  /** The server's release version, e.g. `0.1.0`. */
  version: Scalars['String']['output'];
};

export type ServerMember = {
  avatarUrl?: Maybe<Scalars['String']['output']>;
  bio?: Maybe<Scalars['String']['output']>;
  displayName?: Maybe<Scalars['String']['output']>;
  joinedAt: Scalars['DateTime']['output'];
  memberRole: ServerMemberRoleGql;
  /** The member's key identity (`rimp1_…`), once enrolled; null for a password-only account. */
  principalId?: Maybe<Scalars['String']['output']>;
  serverId: Scalars['ID']['output'];
  statusText?: Maybe<Scalars['String']['output']>;
  /** End of the member's timeout while one is in force (Track 1.2), else null. */
  timeoutUntil?: Maybe<Scalars['DateTime']['output']>;
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

/**
 * GraphQL exposure of `rim_core::server_member::model::ServerMemberRole`. Reused (not
 * duplicated) across every place a member's role needs to cross the wire — `Server.viewerRole`,
 * `ServerMember.memberRole`, `CreateInviteInput.role`, `setMemberRole`.
 */
export enum ServerMemberRoleGql {
  GUEST = 'GUEST',
  MEMBER = 'MEMBER',
  MODERATOR = 'MODERATOR',
  OWNER = 'OWNER'
}

export type SetWorkspaceStateInput = {
  key: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
  ttlSeconds?: InputMaybe<Scalars['Int']['input']>;
  value: Scalars['JSON']['input'];
};

/** A stored signed statement, exactly as it was signed, so the client can verify it again. */
export type SignedStatement = {
  payload: Scalars['String']['output'];
  signature: Scalars['String']['output'];
};

/**
 * A signed statement as the client sends it: the exact JSON text that was signed, and its
 * signature (`ed25519:<base64url>` in version 2 statements, bare base64url in version 1).
 */
export type SignedStatementInput = {
  payload: Scalars['String']['input'];
  signature: Scalars['String']['input'];
};

/**
 * Input for `signupWithInvite`.
 *
 * Exactly one token MUST be set in invite-only mode; all must be absent in
 * open mode. The resolver enforces this with a `Validation` error.
 *
 * `email` is required (max 254 chars, server trims + lowercases, case-insensitive unique).
 * `displayName` is optional; falls back to `username` server-side if absent or blank.
 */
export type SignupWithInviteInput = {
  /**
   * Optional display name (1–80 chars when present). Falls back to `username`
   * when absent or blank after trim.
   */
  displayName?: InputMaybe<Scalars['String']['input']>;
  /**
   * Required. The user's email address. Trimmed and lowercased before storage.
   * Must match the pragmatic email regex from spec §13.3.
   */
  email: Scalars['String']['input'];
  instanceInviteToken?: InputMaybe<Scalars['String']['input']>;
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
  workspaceInviteToken?: InputMaybe<Scalars['String']['input']>;
};

/**
 * Payload returned from `signupWithInvite`.
 *
 * `server_id` is `Some` only when a `workspaceInviteToken` was used;
 * the instance-invite and open paths land in "no workspaces yet" state.
 */
export type SignupWithInvitePayloadGql = {
  serverId?: Maybe<Scalars['ID']['output']>;
  userId: Scalars['ID']['output'];
};

/**
 * Input for `signupWithKey`: an account created from a key identity alone, with no password
 * and no email. The tokens follow the same rules as `signupWithInvite`: exactly one in
 * invite-only mode, none in open mode. In pow mode it takes one token or `proofOfWork`.
 */
export type SignupWithKeyInput = {
  /** Certificate of the device signing up; the new session belongs to it. */
  device: SignedStatementInput;
  /**
   * Optional display name (1–80 chars when present). Falls back to `username` when absent
   * or blank after trim.
   */
  displayName?: InputMaybe<Scalars['String']['input']>;
  instanceInviteToken?: InputMaybe<Scalars['String']['input']>;
  /** The whole key log, inception first. */
  keyLog: Array<SignedStatementInput>;
  /** A `login` statement signed by that device over a fresh `keyLoginChallenge`. */
  proof: SignedStatementInput;
  /**
   * In pow registration mode: an 8-byte nonce, unpadded base64url, such that
   * `SHA-256("rim.pow.v1\0" || server id || "\0" || inception payload || nonce)` starts with
   * the descriptor's `powBits` zero bits.
   */
  proofOfWork?: InputMaybe<Scalars['String']['input']>;
  username: Scalars['String']['input'];
  workspaceInviteToken?: InputMaybe<Scalars['String']['input']>;
};

export type StartedDeviceLink = {
  expiresAt: Scalars['DateTime']['output'];
  /** 16 bytes, unpadded base64url. The server keeps only its hash, so it is shown once. */
  linkId: Scalars['String']['output'];
};

/** The current `seq` of a host event stream, as a decimal string. */
export type StreamHead = {
  seq: Scalars['String']['output'];
  stream: Scalars['String']['output'];
};

export type SubmitMlsCommitInput = {
  /** Required for an incarnation's first Commit (epoch 0). */
  cipherSuite?: InputMaybe<Scalars['Int']['input']>;
  commit: Scalars['String']['input'];
  conversationId: Scalars['ID']['input'];
  epoch: Scalars['Int']['input'];
  incarnation: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
  /** Required when the Commit adds devices. */
  welcome?: InputMaybe<Scalars['String']['input']>;
};

export type Subscription = {
  /**
   * Host events queued for the session's device on this relay, above `after` (the device's
   * cursor when omitted), then live ones, as JSON strings:
   * `{"type":"RelayItem","id","hostServerId","workspaceId","envelope"}`, and the
   * `DmRequestReceived`, `QueueOverflow` and `RevocationAcked` notices. While one is open
   * the hosts of the user's workspaces see them online.
   */
  relayStream: Scalars['String']['output'];
  /**
   * Subscribe to all real-time events for a workspace.
   * Returns events as JSON strings — the client parses the `type` field to determine the event kind.
   */
  workspaceEvents: Scalars['String']['output'];
};


export type SubscriptionRelayStreamArgs = {
  after?: InputMaybe<Scalars['ID']['input']>;
};


export type SubscriptionWorkspaceEventsArgs = {
  workspaceId: Scalars['ID']['input'];
};

export type Thread = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lastMessageAt: Scalars['DateTime']['output'];
  rootAuthorId?: Maybe<Scalars['ID']['output']>;
  rootMessageId?: Maybe<Scalars['ID']['output']>;
  rootText?: Maybe<Scalars['String']['output']>;
  serverId: Scalars['ID']['output'];
};

export type ToggleReactionInput = {
  conversationId: Scalars['ID']['input'];
  emoji: Scalars['String']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export enum TypedVerbGql {
  CLOSE = 'CLOSE',
  CONFIGURE = 'CONFIGURE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
  NAVIGATE = 'NAVIGATE',
  OPEN = 'OPEN',
  OTHER = 'OTHER',
  READ = 'READ',
  SEND = 'SEND',
  TOGGLE = 'TOGGLE',
  WRITE = 'WRITE'
}

export type UnmuteConversationInput = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type UnpinMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type UnreadCount = {
  conversationId: Scalars['ID']['output'];
  count: Scalars['Int']['output'];
};

export type UpdateChannelLensInput = {
  filterSpec?: InputMaybe<FilterSpecInput>;
  isShared?: InputMaybe<Scalars['Boolean']['input']>;
  lensId: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  serverId: Scalars['ID']['input'];
};

export type UpdateConversationTopicInput = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  topic?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateKeybindInput = {
  commandId: Scalars['String']['input'];
  context: KeybindContext;
  isEnabled: Scalars['Boolean']['input'];
  keybindId: Scalars['ID']['input'];
  keystroke: Scalars['String']['input'];
  presetArgs?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateMacroInput = {
  aiCallable?: Scalars['Boolean']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  intentSamples?: Array<Scalars['String']['input']>;
  macroId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  nlDescription?: Scalars['String']['input'];
  sensitivity?: CommandSensitivity;
  steps: Array<MacroStepInput>;
};

/**
 * Patch fields on the authenticated user's profile.
 *
 * Each field is independently optional. Omitting a field leaves the existing
 * value unchanged. Sending an explicit empty string clears the field
 * (after trim + control-char strip).
 */
export type UpdateMyProfileInput = {
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  bio?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  statusText?: InputMaybe<Scalars['String']['input']>;
};

/** Replaces the editable settings (the manual pause is separate: `setDoNotDisturb`). */
export type UpdateNotificationSettingsInput = {
  defaultLevel: NotificationLevel;
  digest: DigestFrequency;
  /** Null turns the daily window off. */
  dnd?: InputMaybe<DndWindowInput>;
  /** At most 20, each 2 to 40 characters; stored lower-cased and deduplicated. */
  keywords: Array<Scalars['String']['input']>;
};

export type UpdatePipelineInput = {
  actions: Array<PipelineActionInput>;
  cooldownSecs?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<PipelineFilterInput>;
  name: Scalars['String']['input'];
  pipelineId: Scalars['ID']['input'];
  trigger: PipelineTriggerInput;
};

export type UpdateUserCommandInput = {
  commandId: Scalars['String']['input'];
  description: Scalars['String']['input'];
  isEnabled: Scalars['Boolean']['input'];
  steps: Array<UserCommandStepInput>;
  title: Scalars['String']['input'];
};

export type UpdateWorkspacePluginInput = {
  bundleUrl?: InputMaybe<Scalars['String']['input']>;
  pluginId: Scalars['String']['input'];
  publisherKeyLog?: InputMaybe<Array<SignedStatementInput>>;
  serverId: Scalars['ID']['input'];
  /** A new version, or a re-signed one, of the same plugin. */
  statement?: InputMaybe<SignedStatementInput>;
  status?: InputMaybe<WorkspacePluginStatus>;
};

export type UploadTicket = {
  attachmentId: Scalars['ID']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  maxSizeBytes?: Maybe<Scalars['Int']['output']>;
  uploadToken: Scalars['String']['output'];
};

export type User = {
  avatarUrl?: Maybe<Scalars['String']['output']>;
  bio?: Maybe<Scalars['String']['output']>;
  displayName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /**
   * Key-based principal id (`rimp1_...`) once the account enrolled a key; null before. Plugins
   * see this id, and the host maps a provisional `rimp0_` id to it once
   * (`docs/specs/key-identity-v1.md`).
   */
  principalId?: Maybe<Scalars['String']['output']>;
  statusText?: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
};

export type UserCommandStepInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandId: Scalars['String']['input'];
};

export type UserPresenceGql = {
  lastSeenAt: Scalars['DateTime']['output'];
  status: PresenceStatus;
  userId: Scalars['ID']['output'];
};

/**
 * Minimal workspace info included in a workspace-invite preview.
 *
 * See spec §4.7 — inviter name and server name are disclosed because
 * the user was already shown them on the invite-link landing page.
 */
export type WorkspaceInvitePreviewGql = {
  invitedByDisplayName: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  serverName: Scalars['String']['output'];
};

export type WorkspacePlugin = {
  approvedAt: Scalars['DateTime']['output'];
  /** Who approved the entry last; null once that account is deleted. */
  approvedBy?: Maybe<User>;
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** The exact text of `rim-plugin.json` inside the statement. */
  manifest: Scalars['String']['output'];
  pluginId: Scalars['String']['output'];
  /**
   * This server's key log of the publisher when they are enrolled here, else the one stored
   * with the entry.
   */
  publisherKeyLog: Array<SignedStatement>;
  publisherKeySeq: Scalars['Int']['output'];
  /** Chosen by the publisher: it proves nothing about who they are. */
  publisherName: Scalars['String']['output'];
  publisherPrincipalId: Scalars['String']['output'];
  runtimeKind: PluginRuntimeKind;
  serverId: Scalars['ID']['output'];
  signatureStatus: PluginSignatureStatus;
  source: PluginSource;
  statement: SignedStatement;
  status: WorkspacePluginStatus;
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['String']['output'];
};

export enum WorkspacePluginStatus {
  RECOMMENDED = 'RECOMMENDED',
  /** Offered to every member when the workspace opens; never installed without consent. */
  REQUIRED = 'REQUIRED'
}

export type WorkspaceStateEntryGql = {
  createdAt: Scalars['DateTime']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  key: Scalars['String']['output'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  userId?: Maybe<Scalars['ID']['output']>;
  value: Scalars['JSON']['output'];
  version: Scalars['Int']['output'];
};

export enum WorkspaceStateScopeGql {
  SERVER = 'SERVER',
  USER = 'USER'
}
