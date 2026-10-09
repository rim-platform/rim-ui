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

export type AdvanceIncidentPhaseInput = {
  incidentId: Scalars['ID']['input'];
  nextPhase: IncidentPhaseNameGql;
  note?: InputMaybe<Scalars['String']['input']>;
};

export type Attachment = {
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

export type Capability = {
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

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
  /**
   * The optional workspace module this command belongs to (Track 0.4), or null when the
   * command is always available. The server already omits commands whose feature is off
   * from `commands`; this lets clients group or explain gated commands.
   */
  feature?: Maybe<WorkspaceFeature>;
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
 * `KEYBIND`, `CONTEXT_MENU`, `PLUGIN`, `CLI`, `MCP`) — async-graphql's
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
  /** MCP (Model Context Protocol) server. */
  MCP = 'MCP',
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
 * GraphQL input for submitting a confirmation proof. Exactly one of
 * `inBandToken` or `outOfBand` MUST be populated; submitting both or
 * neither results in a `VALIDATION` error.
 *
 * `outOfBand` is a Phase-1 placeholder for MCP-style consent flows
 * (M5 / Phase 6); the server currently rejects it with
 * `CONFIRMATION_FAILED { code: UNSUPPORTED }`.
 */
export type ConfirmationProofInput = {
  inBandToken?: InputMaybe<InBandTokenInput>;
  outOfBand?: InputMaybe<OutOfBandProofInput>;
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
  id: Scalars['ID']['output'];
  isArchived: Scalars['Boolean']['output'];
  /** Whether the viewer is a member (for channels: has joined it). */
  isMember: Scalars['Boolean']['output'];
  isMuted: Scalars['Boolean']['output'];
  /** Channels only: visible to its members alone. Fixed at creation. */
  isPrivate: Scalars['Boolean']['output'];
  memberCount: Scalars['Int']['output'];
  memberIds: Array<Scalars['ID']['output']>;
  /**
   * The viewer's own notification level for this conversation (Track 1.3); null inherits
   * the workspace default.
   */
  notificationLevel?: Maybe<NotificationLevel>;
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

export enum ConversationTypeEnum {
  CHANNEL = 'CHANNEL',
  DIRECT = 'DIRECT',
  GROUP = 'GROUP'
}

export type CreateAttachmentInput = {
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
  /** For Channel conversations. */
  isChannel?: InputMaybe<Scalars['Boolean']['input']>;
  /** Channels only: visible to invited members alone. Cannot be changed later. */
  isPrivate?: Scalars['Boolean']['input'];
  /** For Group conversations. */
  memberIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** For DM conversations. */
  otherUserId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomEmojiInput = {
  imageBase64: Scalars['String']['input'];
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};

export type CreateIngestTokenInput = {
  conversationId: Scalars['ID']['input'];
  label: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
  severityDefault?: InputMaybe<IncidentSeverityGql>;
};

/**
 * Result of `createIngestToken` — `raw_token` is surfaced exactly once and is never
 * retrievable again (mirrors invite-token creation).
 */
export type CreateIngestTokenResultGql = {
  rawToken: Scalars['String']['output'];
  token: IngestTokenGql;
};

/**
 * Input for `createInstanceInvite`.
 *
 * Both fields are optional: `expires_at` defaults to `now() + 7 days`,
 * `max_uses` defaults to 1.
 */
export type CreateInstanceInviteInput = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  maxUses?: InputMaybe<Scalars['Int']['input']>;
  /**
   * Optional recipient to email the invite link to (Track B3). Validated server-side;
   * malformed addresses return a validation error.
   */
  recipientEmail?: InputMaybe<Scalars['String']['input']>;
};

/**
 * Payload returned after successfully creating an instance invite.
 *
 * `invite_token` is the raw (unhashed) token — shown to the admin exactly once.
 */
export type CreateInstanceInvitePayloadGql = {
  invite: InstanceInviteGql;
  /** The raw invite token. Shown to the admin once; never stored unhashed. */
  inviteToken: Scalars['String']['output'];
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

export type DefaultKeybind = {
  commandId: Scalars['String']['output'];
  context: KeybindContext;
  keystroke: Scalars['String']['output'];
  presetArgs?: Maybe<Scalars['JSON']['output']>;
  source: KeybindSource;
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

/** How often unread notifications are emailed. */
export enum DigestFrequency {
  DAILY = 'DAILY',
  HOURLY = 'HOURLY',
  OFF = 'OFF'
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

/**
 * `MENTION_IN_CHANNEL`/`EMAIL` — `PUSH` is reserved for a future track and intentionally has no
 * GraphQL representation yet (mirrors `rim_core::escalation::model::EscalationAction`, which has
 * no `Push` variant either — see that enum's doc comment).
 */
export enum EscalationActionKindGql {
  EMAIL = 'EMAIL',
  MENTION_IN_CHANNEL = 'MENTION_IN_CHANNEL'
}

export type EscalationPolicyGql = {
  createdAt: Scalars['DateTime']['output'];
  createdBy: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  /** Ordered by `position`. */
  steps: Array<EscalationStepGql>;
  updatedAt: Scalars['DateTime']['output'];
};

export enum EscalationRunStatusGql {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED'
}

export type EscalationStepGql = {
  actions: Array<EscalationActionKindGql>;
  delaySeconds: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  policyId: Scalars['ID']['output'];
  /** 0-based order within the policy. */
  position: Scalars['Int']['output'];
  targetKind: EscalationTargetKindGql;
  /** Present only when `targetKind` is `ON_CALL`. */
  targetScheduleId?: Maybe<Scalars['ID']['output']>;
  /** Present only when `targetKind` is `USER`. */
  targetUserId?: Maybe<Scalars['ID']['output']>;
};

/**
 * A step input for `createEscalationPolicy`/`updateEscalationPolicy` — no `id`/`policyId`
 * (assigned by the repository) since the full step list is replaced atomically (§3).
 */
export type EscalationStepInputGql = {
  /** At least one action is required — enforced at the service boundary. */
  actions: Array<EscalationActionKindGql>;
  delaySeconds: Scalars['Int']['input'];
  target: EscalationTargetInputGql;
};

/**
 * An `EscalationTarget`, flattened for GraphQL: `kind` selects which of `userId`/`scheduleId`
 * is populated (GraphQL has no native tagged-union input type) — same flattened-union pattern
 * as [`RotationKindInputGql`], including strict rejection of a field that belongs to the
 * *other* kind.
 */
export type EscalationTargetInputGql = {
  kind: EscalationTargetKindGql;
  /** Required for `ON_CALL`; must not be set for `USER`. */
  scheduleId?: InputMaybe<Scalars['ID']['input']>;
  /** Required for `USER`; must not be set for `ON_CALL`. */
  userId?: InputMaybe<Scalars['ID']['input']>;
};

/** Discriminator for [`EscalationStepGql::target_kind`] / [`EscalationTargetInputGql::kind`]. */
export enum EscalationTargetKindGql {
  ON_CALL = 'ON_CALL',
  USER = 'USER'
}

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
   * **Deprecated** — use `confirmation` instead. Pre-Phase-1 callers
   * (the unmigrated frontend) set this to `true` after `window.confirm()`.
   * When `confirmation` is absent and this is `Some(true)`, the server
   * synthesizes a self-issued in-band proof so the H1 gate has a single
   * authoritative path. Removed in Phase 4 once the frontend modal lands.
   */
  confirmedDangerous?: InputMaybe<Scalars['Boolean']['input']>;
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
   * **Deprecated** — see `ExecuteCommandInput.confirmed_dangerous`.
   * Removed in Phase 4.
   */
  confirmedDangerous?: InputMaybe<Scalars['Boolean']['input']>;
  /**
   * Who triggered this macro. Same back-compat semantics as
   * `ExecuteCommandInput.initiator`: optional, server-defaults to
   * `PALETTE`.
   */
  initiator?: InputMaybe<CommandInitiator>;
  macroId: Scalars['ID']['input'];
};

export type FeatureUsage = {
  featureId: Scalars['String']['output'];
  firstUsedAt: Scalars['DateTime']['output'];
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
 * Read projection of the DB `escalation_run` row for a live incident (§10 FLAG C) — backs
 * `Incident.escalationRun`. See `IncidentGql`'s `escalation_run` resolver for the
 * nullability rationale.
 */
export type IncidentEscalationRunGql = {
  currentStepIndex: Scalars['Int']['output'];
  nextFireAt?: Maybe<Scalars['DateTime']['output']>;
  status: EscalationRunStatusGql;
};

export type IncidentGql = {
  /** Set by `acknowledgeIncident` (§4). `None` until acked. */
  acknowledgedAt?: Maybe<Scalars['DateTime']['output']>;
  /**
   * Bare id companion to `acknowledgedByUser` below — kept alongside it (rather than only
   * exposing the nested object) so a client that only needs the id avoids a DataLoader round
   * trip (§10).
   */
  acknowledgedBy?: Maybe<Scalars['ID']['output']>;
  /**
   * Nested `User` for `acknowledgedBy`, resolved via the shared `User` DataLoader (the
   * `message.author` pattern) rather than requiring a second round-trip. `None` if the
   * incident hasn't been acknowledged.
   */
  acknowledgedByUser?: Maybe<User>;
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  /**
   * The escalation policy armed at declare time, if any (§3/§10). `None` if the incident was
   * declared without an escalation chain.
   */
  escalationPolicyId?: Maybe<Scalars['ID']['output']>;
  /**
   * The incident's active escalation run, if any (§10 FLAG C) — lets a client loading
   * mid-incident, or reconnecting, render a live "escalating to L2 in 4:32" countdown (the
   * `EscalationStepFired` event alone can't give `nextFireAt` to a fresh client). `None` if no
   * policy is attached, or the run has already completed/been cancelled — only the currently
   * `Active` run is meaningful to show. Pure read projection of the DB `escalation_run` row;
   * adds no persistence.
   */
  escalationRun?: Maybe<IncidentEscalationRunGql>;
  id: Scalars['ID']['output'];
  mitigatedAt?: Maybe<Scalars['DateTime']['output']>;
  originalTopic?: Maybe<Scalars['String']['output']>;
  postmortemDraft?: Maybe<Scalars['String']['output']>;
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  serverId: Scalars['ID']['output'];
  severity?: Maybe<IncidentSeverityGql>;
  startedAt: Scalars['DateTime']['output'];
  startedBy: Scalars['ID']['output'];
  status: IncidentStatusGql;
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type IncidentListCursorInput = {
  createdAt: Scalars['DateTime']['input'];
  incidentId: Scalars['ID']['input'];
};

export type IncidentListCursorOutput = {
  createdAt: Scalars['DateTime']['output'];
  incidentId: Scalars['ID']['output'];
};

export type IncidentMessageTagGql = {
  incidentId: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  phase: IncidentPhaseNameGql;
  tagType?: Maybe<MessageTagTypeGql>;
};

export type IncidentPage = {
  items: Array<IncidentGql>;
  next?: Maybe<IncidentListCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<IncidentListCursorOutput>;
};

export type IncidentPhaseGql = {
  endedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  incidentId: Scalars['ID']['output'];
  note?: Maybe<Scalars['String']['output']>;
  phase: IncidentPhaseNameGql;
  startedAt: Scalars['DateTime']['output'];
};

export enum IncidentPhaseNameGql {
  DETECTION = 'DETECTION',
  MITIGATION = 'MITIGATION',
  POSTMORTEM = 'POSTMORTEM',
  RESOLUTION = 'RESOLUTION',
  TRIAGE = 'TRIAGE'
}

export enum IncidentSeverityGql {
  SEV_1 = 'SEV_1',
  SEV_2 = 'SEV_2',
  SEV_3 = 'SEV_3',
  SEV_4 = 'SEV_4'
}

export enum IncidentStatusGql {
  ACTIVE = 'ACTIVE',
  MITIGATED = 'MITIGATED',
  RESOLVED = 'RESOLVED'
}

export type IncidentTimelineGql = {
  incident: IncidentGql;
  phases: Array<IncidentPhaseGql>;
  taggedMessages: Array<IncidentMessageTagGql>;
};

export type IncrementWorkspaceStateInput = {
  delta: Scalars['Int']['input'];
  key: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
};

/**
 * GraphQL projection of an alert-ingest token (Track B2). Never exposes `token_hash` — the raw
 * token is only ever returned once, at creation, via [`CreateIngestTokenResultGql::raw_token`].
 */
export type IngestTokenGql = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdBy: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  lastUsedAt?: Maybe<Scalars['DateTime']['output']>;
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
  serverId: Scalars['ID']['output'];
  severityDefault?: Maybe<IncidentSeverityGql>;
};

/**
 * Output type for an instance invite (admin view).
 *
 * Mirrors the `InstanceInvite` SDL type in spec §9.2.
 * Note: the raw invite token is **not** exposed here — it is only emitted
 * once in `CreateInstanceInvitePayload.inviteToken`.
 */
export type InstanceInviteGql = {
  createdAt: Scalars['DateTime']['output'];
  createdByUserId: Scalars['ID']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  maxUses: Scalars['Int']['output'];
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
  useCount: Scalars['Int']['output'];
};

export type Invite = {
  createdByUserId: Scalars['ID']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  maxUses: Scalars['Int']['output'];
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Role granted on join: `MEMBER` or `GUEST` (Track 1.2). */
  role: ServerMemberRoleGql;
  serverId: Scalars['ID']['output'];
  useCount: Scalars['Int']['output'];
};

/**
 * Read-only preview of a registration token.
 *
 * Does NOT consume the token. Workspace-invite previews carry server and
 * inviter info; instance/bootstrap previews are minimal (§4.7).
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
 * `BOOTSTRAP` and `INSTANCE` both trigger the "create your RIM account" form
 * copy on the frontend, but they are distinct so the frontend knows which input
 * field to populate on `signupWithInvite`:
 * - `BOOTSTRAP` → use `bootstrapToken`
 * - `INSTANCE`  → use `instanceInviteToken`
 *
 * Mirrors [`rim_services::auth::dto::InviteTokenType`].
 */
export enum InviteTokenTypeGql {
  /** Bootstrap token: routes to `bootstrapToken` input on `signupWithInvite`. */
  BOOTSTRAP = 'BOOTSTRAP',
  /** Instance invite: routes to `instanceInviteToken` input on `signupWithInvite`. */
  INSTANCE = 'INSTANCE',
  /** Workspace invite: join-a-workspace flow. */
  WORKSPACE = 'WORKSPACE'
}

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

export type KeybindLayers = {
  defaultKeybind?: Maybe<DefaultKeybind>;
  resolvedPersistedKeybind?: Maybe<Keybind>;
  userKeybind?: Maybe<Keybind>;
  workspaceKeybind?: Maybe<Keybind>;
};

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

export type MessagePage = {
  items: Array<Message>;
  next?: Maybe<MessageCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<MessageCursorOutput>;
};

export type MessageReference = {
  anchor: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  permalinkPath: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
};

/**
 * A member's report of a message. `messageText` and `messageAuthorId` are present only when
 * the viewing moderator can read the conversation (`messageReadable`); otherwise only the ids
 * and the reporter's reason are shown. `messageText` is also null for a deleted message.
 */
export type MessageReport = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  messageAuthorId?: Maybe<Scalars['ID']['output']>;
  messageId: Scalars['ID']['output'];
  messageReadable: Scalars['Boolean']['output'];
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

export enum MessageTagTypeGql {
  ACTION_ITEM = 'ACTION_ITEM',
  DECISION = 'DECISION',
  ROOT_CAUSE = 'ROOT_CAUSE',
  TIMELINE_EVENT = 'TIMELINE_EVENT'
}

export type Mutation = {
  /**
   * Acknowledge an incident (§4). Any server member may ack, not owner-gated — whoever
   * responds picked it up. Idempotent: acking an already-acked incident returns it unchanged.
   * Cancels the incident's active escalation run, if any.
   */
  acknowledgeIncident: IncidentGql;
  /** Add (invite) workspace members to a channel or group the caller belongs to. */
  addConversationMembers: Conversation;
  /** Add a device certified by the current identity key. */
  addDeviceKey: DeviceKey;
  /** Add a rotation layer to a schedule. Owner-only. */
  addRotationLayer: RotationLayerGql;
  advanceIncidentPhase: IncidentPhaseGql;
  /**
   * Remove a member and block them from re-joining until `expiresAt` (or until unbanned
   * when omitted). Same targeting rules as `kickMember`. Audited.
   */
  banMember: ServerBan;
  /** End a member's timeout early. Returns whether one was in force. Audited. */
  clearTimeout: Scalars['Boolean']['output'];
  createAttachment: UploadTicket;
  createChannelLens: ChannelLens;
  createConversation: Conversation;
  createCustomEmoji: CustomEmoji;
  /**
   * Create an escalation policy. Owner+Moderator (server-scoped — per-channel moderator
   * roles don't apply). Every step target is validated to belong to this server (C1 security
   * review): a `User` target must be a current member, an `OnCall` target's schedule must
   * belong to this server.
   */
  createEscalationPolicy: EscalationPolicyGql;
  /**
   * Mint a new alert-ingest token for a channel. Owner-only. The raw token is returned
   * exactly once, in `rawToken` — it is never retrievable again after this call.
   */
  createIngestToken: CreateIngestTokenResultGql;
  /**
   * Create a new instance invite (admin-only gate: must own at least one workspace).
   *
   * Returns the raw invite token exactly once in the payload. Store it; it cannot
   * be retrieved again.
   */
  createInstanceInvite: CreateInstanceInvitePayloadGql;
  createInvite: CreateInvitePayload;
  createKeybind: Keybind;
  createMacro: MacroDef;
  /** Create a one-off on-call override for a schedule. Owner-only. */
  createOnCallOverride: OnCallOverrideGql;
  /** Create an on-call schedule. Owner-only. */
  createOnCallSchedule: OnCallScheduleGql;
  createPipeline: PipelineGql;
  createServer: Server;
  createUserCommand: Command;
  deleteAttachment: Scalars['Boolean']['output'];
  deleteChannelLens: Scalars['Boolean']['output'];
  deleteCustomEmoji: Scalars['Boolean']['output'];
  /** Delete an escalation policy. Owner+Moderator (resolved via the policy's own server). */
  deleteEscalationPolicy: Scalars['Boolean']['output'];
  deleteKeybind: Scalars['Boolean']['output'];
  deleteMacro: Scalars['Boolean']['output'];
  deleteMessage: Scalars['Boolean']['output'];
  /** Delete an on-call override. Owner-only (resolved via the override's owning schedule). */
  deleteOnCallOverride: Scalars['Boolean']['output'];
  /**
   * Delete an on-call schedule (cascades to its rotation layers/participants/overrides).
   * Owner-only.
   */
  deleteOnCallSchedule: Scalars['Boolean']['output'];
  deletePipeline: Scalars['Boolean']['output'];
  deleteUserCommand: Scalars['Boolean']['output'];
  deleteWorkspaceState: Scalars['Boolean']['output'];
  editMessage: Message;
  /** Bind a key identity to the signed-in account. Afterwards the password no longer signs in. */
  enrollIdentityKey: KeyIdentity;
  executeCommand: CommandResult;
  executeMacro: CommandResult;
  finalizeAttachment: Attachment;
  forwardMessage: Message;
  generatePostmortem: IncidentGql;
  heartbeat: Scalars['Boolean']['output'];
  incrementWorkspaceState: WorkspaceStateEntryGql;
  /** Join a public, unarchived channel. Idempotent. */
  joinChannel: Conversation;
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
  login: LoginPayload;
  /**
   * Sign in with a `login` statement signed by an enrolled device key. Sets the same session
   * cookie as `login`.
   */
  loginWithKey: LoginPayload;
  logout: Scalars['Boolean']['output'];
  markAllAsRead: Scalars['Boolean']['output'];
  markAsRead: Scalars['Boolean']['output'];
  /**
   * Mark the viewer's notifications read: the given `ids`, or every notification created at
   * or before `allBefore` (exactly one of the two). Returns how many changed.
   */
  markNotificationsRead: Scalars['Int']['output'];
  muteConversation: Scalars['Boolean']['output'];
  overrideSkillTier: SkillProfileGql;
  pinMessage: Scalars['Boolean']['output'];
  /** Publish a profile card signed by the current identity key. */
  publishProfileCard: ProfileCard;
  recordFeatureUsage: SkillProfileGql;
  /**
   * Remove a member from a channel or group: Owner/Moderator may remove anyone, others only
   * themselves.
   */
  removeConversationMember: Scalars['Boolean']['output'];
  /** Remove a rotation layer (cascades to its participants). Owner-only. */
  removeRotationLayer: Scalars['Boolean']['output'];
  replyToMessage: Message;
  /**
   * Report a message to the workspace moderators. Any member who can read it, once per
   * message (`CONFLICT` on a second report). Audited (`chat.report_message`).
   */
  reportMessage: MessageReport;
  requestPasswordReset: Scalars['Boolean']['output'];
  resetPassword: Scalars['Boolean']['output'];
  resolveIncident: IncidentGql;
  /**
   * Close an open report as resolved or dismissed (Owner/Moderator). Audited
   * (`admin.resolve_report`).
   */
  resolveReport: MessageReport;
  /** Revoke a device, signed by the identity key or by the device itself. Ends its sessions. */
  revokeDeviceKey: DeviceKey;
  /** Revoke an ingest token. Owner-only, permanent (no un-revoke). */
  revokeIngestToken: Scalars['Boolean']['output'];
  /**
   * Revoke an existing instance invite (admin-only gate: must own at least one workspace).
   *
   * Returns `true` on success. Returns `NOT_FOUND` if the invite does not exist.
   */
  revokeInstanceInvite: Scalars['Boolean']['output'];
  revokeInvite: Scalars['Boolean']['output'];
  /**
   * Append a rotation to the key log. A rotation signed by the recovery key works without a
   * session, revokes every device and session, and enrolls the device given with it.
   */
  rotateIdentityKey: KeyIdentity;
  sendMessage: Message;
  /**
   * Set a conversation's default escalation policy — the policy `ingestAlert`-declared
   * incidents always use (there's no human to pick an override for an alert-declared
   * incident), and `startIncident`'s fallback when no per-call override is given.
   * Owner+Moderator.
   */
  setChannelEscalationPolicy: Scalars['Boolean']['output'];
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
   * Replace a rotation layer's full ordered participant list. `userIds[0]` becomes the first
   * shift. Owner-only.
   */
  setRotationParticipants: RotationLayerGql;
  /**
   * Set a channel's slow mode, in seconds (0 to 21600; 0 turns it off). Owner/Moderator.
   * Audited (`chat.set_slow_mode`).
   */
  setSlowMode: Conversation;
  /**
   * Turn an optional workspace module on or off. Owner-only. No data is deleted when a
   * feature is turned off; turning it back on restores everything. Audited.
   */
  setWorkspaceFeature: WorkspaceFeatureState;
  setWorkspaceState: WorkspaceStateEntryGql;
  /**
   * Unified signup mutation for all token-based and open-mode registration paths.
   *
   * In invite-only mode, exactly one of `bootstrapToken`, `instanceInviteToken`,
   * or `workspaceInviteToken` must be supplied.
   * In open mode, all token fields must be absent.
   *
   * On success, sets session and CSRF cookies via `AuthIntent`.
   */
  signupWithInvite: SignupWithInvitePayloadGql;
  startIncident: IncidentGql;
  startTyping: Scalars['Boolean']['output'];
  tagIncidentMessage: IncidentMessageTagGql;
  /**
   * Time a member out until `until` (at most 30 days ahead): they keep reading but every
   * write fails with `TIMED_OUT`. Same targeting rules as `kickMember`. Audited.
   */
  timeoutMember: MemberTimeout;
  togglePipeline: PipelineGql;
  toggleReaction: Array<ReactionGroup>;
  /** Lift a ban (Owner/Moderator). Returns whether a ban existed. Audited. */
  unbanMember: Scalars['Boolean']['output'];
  unmuteConversation: Scalars['Boolean']['output'];
  unpinMessage: Scalars['Boolean']['output'];
  updateChannelLens: ChannelLens;
  updateConversationTopic: Conversation;
  /**
   * Update an escalation policy's `name` and/or full step list. `steps: Some(_)` replaces
   * every step atomically; `None` leaves the existing steps untouched. Owner+Moderator
   * (resolved via the policy's own server); same per-target server constraint as create.
   */
  updateEscalationPolicy: EscalationPolicyGql;
  updateIncidentStatus: IncidentGql;
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
  /** Update an on-call schedule's `name`/`timezone`. Owner-only. */
  updateOnCallSchedule: OnCallScheduleGql;
  updatePipeline: PipelineGql;
  /**
   * Update a rotation layer's `name`/`priority`/`kind`/`anchorAt`. Owner-only (resolved via
   * the layer's owning schedule).
   */
  updateRotationLayer: RotationLayerGql;
  updateUserCommand: Command;
};


export type MutationAcknowledgeIncidentArgs = {
  incidentId: Scalars['ID']['input'];
};


export type MutationAddConversationMembersArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  userIds: Array<Scalars['ID']['input']>;
};


export type MutationAddDeviceKeyArgs = {
  certificate: SignedStatementInput;
};


export type MutationAddRotationLayerArgs = {
  anchorAt: Scalars['DateTime']['input'];
  kind: RotationKindInputGql;
  name: Scalars['String']['input'];
  priority: Scalars['Int']['input'];
  scheduleId: Scalars['ID']['input'];
};


export type MutationAdvanceIncidentPhaseArgs = {
  input: AdvanceIncidentPhaseInput;
};


export type MutationBanMemberArgs = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  reason?: InputMaybe<Scalars['String']['input']>;
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationClearTimeoutArgs = {
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
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


export type MutationCreateEscalationPolicyArgs = {
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
  steps: Array<EscalationStepInputGql>;
};


export type MutationCreateIngestTokenArgs = {
  input: CreateIngestTokenInput;
};


export type MutationCreateInstanceInviteArgs = {
  input: CreateInstanceInviteInput;
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


export type MutationCreateOnCallOverrideArgs = {
  endAt: Scalars['DateTime']['input'];
  scheduleId: Scalars['ID']['input'];
  startAt: Scalars['DateTime']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationCreateOnCallScheduleArgs = {
  name: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
  timezone: Scalars['String']['input'];
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


export type MutationDeleteEscalationPolicyArgs = {
  policyId: Scalars['ID']['input'];
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


export type MutationDeleteOnCallOverrideArgs = {
  overrideId: Scalars['ID']['input'];
};


export type MutationDeleteOnCallScheduleArgs = {
  scheduleId: Scalars['ID']['input'];
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


export type MutationGeneratePostmortemArgs = {
  incidentId: Scalars['ID']['input'];
};


export type MutationHeartbeatArgs = {
  input: HeartbeatInput;
};


export type MutationIncrementWorkspaceStateArgs = {
  input: IncrementWorkspaceStateInput;
};


export type MutationJoinChannelArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
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


export type MutationOverrideSkillTierArgs = {
  tier: SkillTier;
};


export type MutationPinMessageArgs = {
  input: PinMessageInput;
};


export type MutationPublishProfileCardArgs = {
  card: SignedStatementInput;
};


export type MutationRecordFeatureUsageArgs = {
  featureId: Scalars['String']['input'];
};


export type MutationRemoveConversationMemberArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationRemoveRotationLayerArgs = {
  layerId: Scalars['ID']['input'];
};


export type MutationReplyToMessageArgs = {
  input: ReplyToMessageInput;
};


export type MutationReportMessageArgs = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationRequestPasswordResetArgs = {
  username: Scalars['String']['input'];
};


export type MutationResetPasswordArgs = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};


export type MutationResolveIncidentArgs = {
  incidentId: Scalars['ID']['input'];
};


export type MutationResolveReportArgs = {
  outcome: ReportOutcome;
  reportId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationRevokeDeviceKeyArgs = {
  revocation: SignedStatementInput;
};


export type MutationRevokeIngestTokenArgs = {
  tokenId: Scalars['ID']['input'];
};


export type MutationRevokeInstanceInviteArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationRevokeInviteArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationRotateIdentityKeyArgs = {
  input: RotateIdentityKeyInput;
};


export type MutationSendMessageArgs = {
  input: SendMessageInput;
};


export type MutationSetChannelEscalationPolicyArgs = {
  conversationId: Scalars['ID']['input'];
  policyId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
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


export type MutationSetRotationParticipantsArgs = {
  layerId: Scalars['ID']['input'];
  userIds: Array<Scalars['ID']['input']>;
};


export type MutationSetSlowModeArgs = {
  conversationId: Scalars['ID']['input'];
  seconds: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationSetWorkspaceFeatureArgs = {
  enabled: Scalars['Boolean']['input'];
  feature: WorkspaceFeature;
  serverId: Scalars['ID']['input'];
};


export type MutationSetWorkspaceStateArgs = {
  input: SetWorkspaceStateInput;
};


export type MutationSignupWithInviteArgs = {
  input: SignupWithInviteInput;
};


export type MutationStartIncidentArgs = {
  input: StartIncidentInput;
};


export type MutationStartTypingArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type MutationTagIncidentMessageArgs = {
  input: TagIncidentMessageInput;
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


export type MutationUpdateEscalationPolicyArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  policyId: Scalars['ID']['input'];
  steps?: InputMaybe<Array<EscalationStepInputGql>>;
};


export type MutationUpdateIncidentStatusArgs = {
  input: UpdateIncidentStatusInput;
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


export type MutationUpdateOnCallScheduleArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  scheduleId: Scalars['ID']['input'];
  timezone?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdatePipelineArgs = {
  input: UpdatePipelineInput;
};


export type MutationUpdateRotationLayerArgs = {
  anchorAt?: InputMaybe<Scalars['DateTime']['input']>;
  kind?: InputMaybe<RotationKindInputGql>;
  layerId: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationUpdateUserCommandArgs = {
  input: UpdateUserCommandInput;
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

/**
 * Answer to "who is on call now" (`whoIsOnCall`/`serverOnCall` queries). `currentUser`/`nextUser`
 * are resolved via the shared `User` DataLoader (the `message.author` pattern) rather than
 * exposed as bare ids.
 */
export type OnCallNowGql = {
  currentUser?: Maybe<User>;
  nextUser?: Maybe<User>;
  scheduleId: Scalars['ID']['output'];
  shiftEndsAt?: Maybe<Scalars['DateTime']['output']>;
};

export type OnCallOverrideGql = {
  createdBy: Scalars['ID']['output'];
  endAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  scheduleId: Scalars['ID']['output'];
  startAt: Scalars['DateTime']['output'];
  userId: Scalars['ID']['output'];
};

export type OnCallScheduleGql = {
  createdAt: Scalars['DateTime']['output'];
  createdBy: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /**
   * This schedule's existing rotation layers, each with its participants attached, ordered
   * `priority DESC, created_at ASC` (§10) — lets the frontend editor load and edit existing
   * rotations rather than only being able to create new ones. Any server member may read.
   */
  rotationLayers: Array<RotationLayerGql>;
  serverId: Scalars['ID']['output'];
  timezone: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

/**
 * One contiguous block of on-call coverage (`onCallShifts` query). `user` is resolved via the
 * shared `User` DataLoader, not exposed as a bare id.
 */
export type OnCallShiftGql = {
  endAt: Scalars['DateTime']['output'];
  /**
   * `true` if this block came from a one-off `OnCallOverride` rather than the base rotation
   * layer (§10 FLAG B) — lets the frontend render override segments distinctly.
   */
  isOverride: Scalars['Boolean']['output'];
  startAt: Scalars['DateTime']['output'];
  user?: Maybe<User>;
};

export type OutOfBandProofInput = {
  requestId: Scalars['String']['input'];
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

export enum PresenceStatus {
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
  ONLINE = 'ONLINE'
}

export type ProfileCard = {
  statement: SignedStatement;
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type Query = {
  activeIncident?: Maybe<IncidentGql>;
  applyChannelLens: Array<Message>;
  attachment: Attachment;
  capabilities: Array<Capability>;
  channelLenses: Array<ChannelLens>;
  channels: ChannelPage;
  command?: Maybe<Command>;
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
  conversation: Conversation;
  customEmojis: Array<CustomEmoji>;
  defaultKeybinds: Array<DefaultKeybind>;
  /** List a server's escalation policies. Any workspace member may read. */
  escalationPolicies: Array<EscalationPolicyGql>;
  inboxConversations: ConversationPage;
  incidentTimeline: IncidentTimelineGql;
  /** List every alert-ingest token for a server (including revoked). Owner-only. */
  ingestTokens: Array<IngestTokenGql>;
  /**
   * The public key log of a principal enrolled on this server, oldest first; empty when none
   * is. No session needed: a person who lost every device reads the head here to sign a
   * recovery rotation (`rotateIdentityKey`).
   */
  keyLog: Array<KeyLogEntry>;
  keybindLayers: KeybindLayers;
  keybinds: Array<Keybind>;
  /** Query the command audit log. Requires `audit.read` capability. */
  listAuditLog: AuditLogPage;
  listIncidents: IncidentPage;
  /**
   * List all active (non-revoked) instance invites.
   *
   * Admin-only: requires the caller to be `Owner` on at least one workspace.
   * Returns `FORBIDDEN` otherwise.
   */
  listInstanceInvites: Array<InstanceInviteGql>;
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
  messageReference: MessageReference;
  /**
   * Message reports of the workspace (all statuses when `status` is omitted), ordered
   * `createdAt ASC, id ASC`. Owner/Moderator only. The message body is included only when
   * the moderator can read the conversation.
   */
  messageReports: MessageReportPage;
  messages: MessagePage;
  mutedConversations: Array<MutedConversation>;
  myInvites: Array<Invite>;
  /** The signed-in account's key log, devices and profile card on this server. */
  myKeyIdentity: KeyIdentity;
  myMacros: Array<MacroDef>;
  myMentions: Array<Message>;
  /** The viewer's notification settings in the workspace (defaults until first saved). */
  myNotificationSettings: NotificationSettings;
  /**
   * The viewer's notifications in the workspace, newest first (`createdAt DESC, id DESC`).
   * `AFTER` pages go to older notifications. Defaults: `unreadOnly` false, `dir` `AFTER`,
   * `limit` 50 (clamped to 1..=100).
   */
  myNotifications: NotificationPage;
  myServers: Array<Server>;
  mySkillProfile: SkillProfileGql;
  /** Unread notifications of the viewer in the workspace (the bell badge). */
  myUnreadNotificationCount: Scalars['Int']['output'];
  /** List a server's on-call schedules. Any workspace member may read. */
  onCallSchedules: Array<OnCallScheduleGql>;
  /**
   * Resolve on-call coverage for a schedule over `[from, to)`. Rejects spans over 90 days. Any
   * workspace member may read.
   */
  onCallShifts: Array<OnCallShiftGql>;
  pinnedMessages: Array<Message>;
  pipeline: PipelineGql;
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
   * Return the deployment-wide registration mode.
   *
   * Used by the login page to decide whether to render a "Sign up" link.
   * No authentication required — this is public configuration metadata.
   */
  registrationMode: RegistrationModeGql;
  resolveKeybind?: Maybe<Keybind>;
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
  serverMacros: Array<MacroDef>;
  serverMembers: Array<ServerMember>;
  /**
   * Batch [`who_is_on_call`] across every on-call schedule on a server — avoids an N+1 of
   * individual `whoIsOnCall` calls for a status-bar-style UI. Any workspace member may read.
   */
  serverOnCall: Array<OnCallNowGql>;
  thread: Thread;
  threadByRootMessage?: Maybe<Thread>;
  threadMessages: MessagePage;
  threads: ThreadPage;
  unreadCounts: Array<UnreadCount>;
  /**
   * Resolve who is on call for a schedule right now (or at `at`, if provided). Any workspace
   * member may read.
   */
  whoIsOnCall: OnCallNowGql;
  /**
   * Per-workspace optional modules and whether each is on (Track 0.4). Any member; one
   * entry per known feature, defaults filled in.
   */
  workspaceFeatures: Array<WorkspaceFeatureState>;
  workspacePresence: Array<UserPresenceGql>;
  workspaceState?: Maybe<WorkspaceStateEntryGql>;
  workspaceStateList: Array<WorkspaceStateEntryGql>;
};


export type QueryActiveIncidentArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryApplyChannelLensArgs = {
  conversationId: Scalars['ID']['input'];
  lensId: Scalars['ID']['input'];
  limit?: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryAttachmentArgs = {
  attachmentId: Scalars['ID']['input'];
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


export type QueryCommandArgs = {
  commandId: Scalars['String']['input'];
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


export type QueryEscalationPoliciesArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryInboxConversationsArgs = {
  cursor?: InputMaybe<InboxCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryIncidentTimelineArgs = {
  incidentId: Scalars['ID']['input'];
};


export type QueryIngestTokensArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryKeyLogArgs = {
  principalId: Scalars['String']['input'];
};


export type QueryKeybindLayersArgs = {
  context: KeybindContext;
  keystroke: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryKeybindsArgs = {
  scope: KeybindScope;
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryListAuditLogArgs = {
  filter?: InputMaybe<AuditLogFilterInput>;
  pagination?: InputMaybe<AuditLogPaginationInput>;
};


export type QueryListIncidentsArgs = {
  cursor?: InputMaybe<IncidentListCursorInput>;
  dir: PageDir;
  limit?: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
  severityFilter?: InputMaybe<Array<IncidentSeverityGql>>;
  statusFilter?: InputMaybe<Array<IncidentStatusGql>>;
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


export type QueryMessageReferenceArgs = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
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


export type QueryMutedConversationsArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyInvitesArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyMacrosArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryMyMentionsArgs = {
  limit?: Scalars['Int']['input'];
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


export type QueryOnCallSchedulesArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryOnCallShiftsArgs = {
  from: Scalars['DateTime']['input'];
  scheduleId: Scalars['ID']['input'];
  to: Scalars['DateTime']['input'];
};


export type QueryPinnedMessagesArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryPipelineArgs = {
  pipelineId: Scalars['ID']['input'];
};


export type QueryPipelinesArgs = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  serverId: Scalars['ID']['input'];
};


export type QueryPreviewInviteTokenArgs = {
  token: Scalars['String']['input'];
};


export type QueryResolveKeybindArgs = {
  context: KeybindContext;
  keystroke: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
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


export type QueryServerMacrosArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerMembersArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerOnCallArgs = {
  serverId: Scalars['ID']['input'];
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


export type QueryThreadsArgs = {
  conversationId: Scalars['ID']['input'];
  cursor?: InputMaybe<ThreadCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryUnreadCountsArgs = {
  workspaceId: Scalars['ID']['input'];
};


export type QueryWhoIsOnCallArgs = {
  at?: InputMaybe<Scalars['DateTime']['input']>;
  scheduleId: Scalars['ID']['input'];
};


export type QueryWorkspaceFeaturesArgs = {
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
 * Variants appear in the SDL as `INVITE_ONLY` and `OPEN`.
 */
export enum RegistrationModeGql {
  /** Default: signup requires a valid token (bootstrap, instance, or workspace invite). */
  INVITE_ONLY = 'INVITE_ONLY',
  /** `RIM_OPEN_REGISTRATION=true`: signup accepts no token; rate-limited. */
  OPEN = 'OPEN'
}

export type ReplyToMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  rootMessageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

/** How a moderator closes a report. */
export enum ReportOutcome {
  DISMISSED = 'DISMISSED',
  RESOLVED = 'RESOLVED'
}

export type RotateIdentityKeyInput = {
  /** Device certificate under the new identity key. Required for a recovery rotation. */
  device?: InputMaybe<SignedStatementInput>;
  entry: SignedStatementInput;
};

/**
 * Discriminator for [`RotationLayerGql::kind`] / [`RotationKindInputGql::kind`]. See
 * `docs/oncall.md` for the timezone/DST semantics of each variant.
 */
export enum RotationKindGql {
  CUSTOM = 'CUSTOM',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY'
}

/**
 * A `RotationKind`, flattened for GraphQL: `kind` selects which of the other fields are
 * populated (GraphQL has no native tagged-union input type). `handoffTime` is `"HH:MM:SS"`
 * 24-hour wall-clock local time.
 */
export type RotationKindInputGql = {
  /** Required for `DAILY`/`WEEKLY`; ignored otherwise. */
  handoffTime?: InputMaybe<Scalars['String']['input']>;
  /** `0` (Monday) .. `6` (Sunday). Required for `WEEKLY`; ignored otherwise. */
  handoffWeekday?: InputMaybe<Scalars['Int']['input']>;
  /** Required for `CUSTOM` (must be `> 0`); ignored otherwise. */
  intervalSeconds?: InputMaybe<Scalars['Int']['input']>;
  kind: RotationKindGql;
};

export type RotationLayerGql = {
  anchorAt: Scalars['DateTime']['output'];
  createdAt: Scalars['DateTime']['output'];
  /** `"HH:MM:SS"`, present only when `kind` is `DAILY`/`WEEKLY`. */
  handoffTime?: Maybe<Scalars['String']['output']>;
  /** `0` (Monday) .. `6` (Sunday), present only when `kind` is `WEEKLY`. */
  handoffWeekday?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  /** Present only when `kind` is `CUSTOM`. */
  intervalSeconds?: Maybe<Scalars['Int']['output']>;
  kind: RotationKindGql;
  name: Scalars['String']['output'];
  /** Ordered by shift position. */
  participants: Array<Scalars['ID']['output']>;
  priority: Scalars['Int']['output'];
  scheduleId: Scalars['ID']['output'];
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

export type SendMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type Server = {
  /**
   * Per-workspace optional modules and whether each is on (Track 0.4). One entry per known
   * feature, defaults filled in. Resolved with one service call per server, like
   * `viewerRole`; `myServers` lists few servers per user, so no DataLoader.
   */
  features: Array<WorkspaceFeatureState>;
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

export type ServerMember = {
  avatarUrl?: Maybe<Scalars['String']['output']>;
  bio?: Maybe<Scalars['String']['output']>;
  displayName?: Maybe<Scalars['String']['output']>;
  joinedAt: Scalars['DateTime']['output'];
  memberRole: ServerMemberRoleGql;
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
  bootstrapToken?: InputMaybe<Scalars['String']['input']>;
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
 * bootstrap and instance-invite paths land in "no workspaces yet" state.
 */
export type SignupWithInvitePayloadGql = {
  serverId?: Maybe<Scalars['ID']['output']>;
  userId: Scalars['ID']['output'];
};

export type SkillProfileGql = {
  featuresUsed: Array<FeatureUsage>;
  skillTier: SkillTier;
  userId: Scalars['ID']['output'];
};

export enum SkillTier {
  ADVANCED = 'ADVANCED',
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE'
}

export type StartIncidentInput = {
  conversationId: Scalars['ID']['input'];
  /**
   * Overrides the conversation's default escalation policy (`setChannelEscalationPolicy`) for
   * just this incident (§3/§10). `None` falls back to that default (or no escalation chain at
   * all if none is set).
   */
  escalationPolicyId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  severity?: InputMaybe<IncidentSeverityGql>;
  title: Scalars['String']['input'];
};

export type Subscription = {
  /**
   * Subscribe to all real-time events for a workspace.
   * Returns events as JSON strings — the client parses the `type` field to determine the event kind.
   */
  workspaceEvents: Scalars['String']['output'];
};


export type SubscriptionWorkspaceEventsArgs = {
  workspaceId: Scalars['ID']['input'];
};

export type TagIncidentMessageInput = {
  incidentId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  tagType?: InputMaybe<MessageTagTypeGql>;
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

export type ThreadCursorInput = {
  lastMessageAt: Scalars['DateTime']['input'];
  threadId: Scalars['ID']['input'];
};

export type ThreadCursorOutput = {
  lastMessageAt: Scalars['DateTime']['output'];
  threadId: Scalars['ID']['output'];
};

export type ThreadPage = {
  items: Array<Thread>;
  next?: Maybe<ThreadCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<ThreadCursorOutput>;
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

export type UpdateIncidentStatusInput = {
  incidentId: Scalars['ID']['input'];
  status: IncidentStatusGql;
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
 * An optional workspace module (Track 0.4). `INCIDENTS` covers incidents, on-call schedules,
 * escalation policies and alert ingestion together.
 */
export enum WorkspaceFeature {
  INCIDENTS = 'INCIDENTS'
}

/**
 * Whether one optional module is on for one workspace. `updatedAt` is null when the value is
 * the feature's default (never explicitly set for this workspace).
 */
export type WorkspaceFeatureState = {
  enabled: Scalars['Boolean']['output'];
  feature: WorkspaceFeature;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
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
