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

export type AcceptInviteInput = {
  inviteToken: Scalars['String']['input'];
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type AcceptInvitePayload = {
  serverId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

export type Action = {
  capabilityIds: Array<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
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

export type BootstrapInput = {
  password: Scalars['String']['input'];
  secret: Scalars['String']['input'];
  serverName: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type BootstrapPayload = {
  serverId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

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
  conversationType: ConversationTypeEnum;
  id: Scalars['ID']['output'];
  isMuted: Scalars['Boolean']['output'];
  memberIds: Array<Scalars['ID']['output']>;
  serverId: Scalars['ID']['output'];
  title?: Maybe<Scalars['String']['output']>;
  topic?: Maybe<Scalars['String']['output']>;
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

/**
 * Input for `createInstanceInvite`.
 *
 * Both fields are optional: `expires_at` defaults to `now() + 7 days`,
 * `max_uses` defaults to 1.
 */
export type CreateInstanceInviteInput = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  maxUses?: InputMaybe<Scalars['Int']['input']>;
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

export type EditMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type Event = {
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
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

export type IncidentGql = {
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
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

export type Integration = {
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  kind: IntegrationKind;
  principalId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
};

export enum IntegrationKind {
  BOT = 'BOT',
  BUILT_IN = 'BUILT_IN',
  LOCAL_PLUGIN = 'LOCAL_PLUGIN',
  WEBHOOK = 'WEBHOOK'
}

export type Invite = {
  createdByUserId: Scalars['ID']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  maxUses: Scalars['Int']['output'];
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
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

export enum MessageTagTypeGql {
  ACTION_ITEM = 'ACTION_ITEM',
  DECISION = 'DECISION',
  ROOT_CAUSE = 'ROOT_CAUSE',
  TIMELINE_EVENT = 'TIMELINE_EVENT'
}

export type Mutation = {
  acceptInvite: AcceptInvitePayload;
  advanceIncidentPhase: IncidentPhaseGql;
  /** @deprecated Use signupWithInvite with a bootstrapToken issued by the rim_server bootstrap-user CLI command. The BOOTSTRAP_SECRET path will be removed in the next minor release. */
  bootstrap: BootstrapPayload;
  createAttachment: UploadTicket;
  createChannelLens: ChannelLens;
  createConversation: Conversation;
  createCustomEmoji: CustomEmoji;
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
  editMessage: Message;
  executeCommand: CommandResult;
  executeMacro: CommandResult;
  finalizeAttachment: Attachment;
  forwardMessage: Message;
  generatePostmortem: IncidentGql;
  heartbeat: Scalars['Boolean']['output'];
  incrementWorkspaceState: WorkspaceStateEntryGql;
  joinServerByInvite: JoinServerByInvitePayload;
  login: LoginPayload;
  logout: Scalars['Boolean']['output'];
  markAllAsRead: Scalars['Boolean']['output'];
  markAsRead: Scalars['Boolean']['output'];
  muteConversation: Scalars['Boolean']['output'];
  overrideSkillTier: SkillProfileGql;
  pinMessage: Scalars['Boolean']['output'];
  recordFeatureUsage: SkillProfileGql;
  replyToMessage: Message;
  requestPasswordReset: Scalars['Boolean']['output'];
  resetPassword: Scalars['Boolean']['output'];
  resolveIncident: IncidentGql;
  /**
   * Revoke an existing instance invite (admin-only gate: must own at least one workspace).
   *
   * Returns `true` on success. Returns `NOT_FOUND` if the invite does not exist.
   */
  revokeInstanceInvite: Scalars['Boolean']['output'];
  revokeInvite: Scalars['Boolean']['output'];
  sendMessage: Message;
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
  togglePipeline: PipelineGql;
  toggleReaction: Array<ReactionGroup>;
  unmuteConversation: Scalars['Boolean']['output'];
  unpinMessage: Scalars['Boolean']['output'];
  updateChannelLens: ChannelLens;
  updateConversationTopic: Conversation;
  updateIncidentStatus: IncidentGql;
  updateKeybind: Keybind;
  updateMacro: MacroDef;
  updatePipeline: PipelineGql;
  updateUserCommand: Command;
};


export type MutationAcceptInviteArgs = {
  input: AcceptInviteInput;
};


export type MutationAdvanceIncidentPhaseArgs = {
  input: AdvanceIncidentPhaseInput;
};


export type MutationBootstrapArgs = {
  input: BootstrapInput;
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


export type MutationEditMessageArgs = {
  input: EditMessageInput;
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


export type MutationJoinServerByInviteArgs = {
  input: JoinServerByInviteInput;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationMarkAllAsReadArgs = {
  input: MarkAllAsReadInput;
};


export type MutationMarkAsReadArgs = {
  input: MarkAsReadInput;
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


export type MutationRecordFeatureUsageArgs = {
  featureId: Scalars['String']['input'];
};


export type MutationReplyToMessageArgs = {
  input: ReplyToMessageInput;
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


export type MutationRevokeInstanceInviteArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationRevokeInviteArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationSendMessageArgs = {
  input: SendMessageInput;
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


export type MutationTogglePipelineArgs = {
  enabled: Scalars['Boolean']['input'];
  pipelineId: Scalars['ID']['input'];
};


export type MutationToggleReactionArgs = {
  input: ToggleReactionInput;
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


export type MutationUpdateIncidentStatusArgs = {
  input: UpdateIncidentStatusInput;
};


export type MutationUpdateKeybindArgs = {
  input: UpdateKeybindInput;
};


export type MutationUpdateMacroArgs = {
  input: UpdateMacroInput;
};


export type MutationUpdatePipelineArgs = {
  input: UpdatePipelineInput;
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

export type Query = {
  actions: Array<Action>;
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
  events: Array<Event>;
  inboxConversations: ConversationPage;
  incidentTimeline: IncidentTimelineGql;
  integrations: Array<Integration>;
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
  messageReference: MessageReference;
  messages: MessagePage;
  mutedConversations: Array<MutedConversation>;
  myInvites: Array<Invite>;
  myMacros: Array<MacroDef>;
  myMentions: Array<Message>;
  myServers: Array<Server>;
  mySkillProfile: SkillProfileGql;
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
  searchMessages: Array<SearchResultMessage>;
  server: Server;
  serverMacros: Array<MacroDef>;
  serverMembers: Array<ServerMember>;
  settings: Array<Setting>;
  thread: Thread;
  threadByRootMessage?: Maybe<Thread>;
  threadMessages: MessagePage;
  threads: ThreadPage;
  unreadCounts: Array<UnreadCount>;
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


export type QueryInboxConversationsArgs = {
  cursor?: InputMaybe<InboxCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryIncidentTimelineArgs = {
  incidentId: Scalars['ID']['input'];
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


export type QueryMessageReferenceArgs = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
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
  conversationId?: InputMaybe<Scalars['ID']['input']>;
  includeDeleted: Scalars['Boolean']['input'];
  limit: Scalars['Int']['input'];
  query: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryServerArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerMacrosArgs = {
  serverId: Scalars['ID']['input'];
};


export type QueryServerMembersArgs = {
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

export type SearchResultMessage = {
  author?: Maybe<User>;
  authorId: Scalars['ID']['output'];
  conversationId: Scalars['ID']['output'];
  conversationTitle?: Maybe<Scalars['String']['output']>;
  conversationType: ConversationTypeEnum;
  id: Scalars['ID']['output'];
  rootMessageId?: Maybe<Scalars['ID']['output']>;
  sentAt: Scalars['DateTime']['output'];
  serverId: Scalars['ID']['output'];
  text?: Maybe<Scalars['String']['output']>;
  threadId?: Maybe<Scalars['ID']['output']>;
};

export type SendMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type Server = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type ServerMember = {
  avatarUrl?: Maybe<Scalars['String']['output']>;
  bio?: Maybe<Scalars['String']['output']>;
  displayName?: Maybe<Scalars['String']['output']>;
  joinedAt: Scalars['DateTime']['output'];
  memberRole: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  statusText?: Maybe<Scalars['String']['output']>;
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

export type SetWorkspaceStateInput = {
  key: Scalars['String']['input'];
  scope: WorkspaceStateScopeGql;
  serverId: Scalars['ID']['input'];
  ttlSeconds?: InputMaybe<Scalars['Int']['input']>;
  value: Scalars['JSON']['input'];
};

export type Setting = {
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isSecret: Scalars['Boolean']['output'];
  scope: SettingScope;
  title: Scalars['String']['output'];
  valueType: Scalars['String']['output'];
};

export enum SettingScope {
  DEVICE_LOCAL = 'DEVICE_LOCAL',
  INTEGRATION = 'INTEGRATION',
  USER = 'USER',
  WORKSPACE = 'WORKSPACE'
}

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
