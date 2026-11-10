import type {
  CommandArgument,
  CommandSensitivity,
  ConfirmationChallenge,
} from "../../core/graphql/generated/schema-types";

// These types mirror the backend GraphQL schema for commands and keybinds.
// When codegen runs, the generated SDK will provide the canonical types.
// These local types allow development without a running backend.

export type CommandSurface = "PALETTE" | "CONTEXT_MENU" | "KEYBIND_PICKER";

export type CommandSourceKind = "BUILT_IN" | "PLUGIN" | "INTEGRATION" | "USER";

export type CommandExecutionTarget = "BACKEND" | "DESKTOP_LOCAL";

export type KeybindContext =
  | "GLOBAL"
  | "COMPOSER"
  | "MESSAGE_LIST"
  | "THREAD_VIEW"
  | "CONVERSATION_VIEW"
  | "PANEL"
  | "COMMAND_PALETTE";

export type KeybindScope = "USER" | "WORKSPACE";

export type KeybindSource = "DEFAULT" | "USER" | "WORKSPACE";

export type CommandResultStatus = "SUCCESS" | "ERROR" | "CONFIRMATION_REQUIRED";

/**
 * What the client reads of an argument a command declares. The fields past `required` are
 * absent on arguments the client describes itself.
 */
export type CommandArgumentInfo = Pick<CommandArgument, "name" | "argumentType" | "required"> &
  Partial<Pick<CommandArgument, "title" | "description" | "defaultValue" | "allowedValues">>;

export interface CommandDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  sourceKind: CommandSourceKind;
  executionTarget: CommandExecutionTarget;
  requiredContext: string[];
  requiredCapabilities: string[];
  visibleInPalette: boolean;
  visibleInContextMenus: boolean;
  keybindCapable: boolean;
  dangerous: boolean;
  /** Server classification; a `RESTRICTED` command needs its verb typed to confirm. */
  sensitivity?: CommandSensitivity;
  /**
   * The arguments the command takes: those the server declares, or, for a command this app
   * defines, those its handler reads; absent when it takes none.
   */
  arguments?: CommandArgumentInfo[];
  /**
   * Set on an app command a plugin may be granted: one that only opens, shows, or moves
   * focus or selection, or starts a form the person finishes. Absent means no plugin runs it.
   */
  pluginRunnable?: boolean;
}

export interface ResolvedKeybind {
  id: string;
  keystroke: string;
  commandId: string;
  context: KeybindContext;
  source: KeybindSource;
  scope: KeybindScope;
  isEnabled: boolean;
  presetArgs: unknown;
}

export interface DefaultKeybind {
  keystroke: string;
  commandId: string;
  context: KeybindContext;
}

export interface PipeStageResult {
  stageIndex: number;
  commandId: string;
  status: CommandResultStatus;
  message: string;
  payload: unknown;
}

export interface CommandResult {
  status: CommandResultStatus;
  message: string;
  payload: unknown;
  followUpCommands: string[];
  pipelineStages?: PipeStageResult[] | null;
  /** The server's challenge when `status` is `CONFIRMATION_REQUIRED`. */
  confirmationRequired?: ConfirmationChallenge | null;
}

export interface ExecuteCommandInput {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: CommandContextInput;
  isPipe?: boolean;
}

export type CommandContextInput = {
  workspaceId?: string;
  conversationId?: string;
  threadId?: string;
  selectedText?: string;
  selectedMessageId?: string;
  selectedMessageIds?: string[];
  focusedSurface?: string;
  activePanel?: string;
};

export interface CreateKeybindInput {
  scope: KeybindScope;
  workspaceId?: string;
  keystroke: string;
  commandId: string;
  context: KeybindContext;
  presetArgs?: unknown;
}

export interface UpdateKeybindInput {
  keybindId: string;
  keystroke: string;
  commandId: string;
  context: KeybindContext;
  presetArgs?: unknown;
  isEnabled: boolean;
}

export interface DeleteKeybindInput {
  keybindId: string;
}

export interface UserCommandStepInput {
  commandId: string;
  args?: Record<string, unknown>;
  /** The arguments asked for when the macro runs; only a server listing `account_macros` takes it. */
  ask?: string[];
}

/** What a server listing `account_macros` also takes for a macro: how the AI agent may use it. */
export interface MacroAgentFields {
  aiCallable?: boolean;
  nlDescription?: string;
  intentSamples?: string[];
}

export interface CreateUserCommandInput extends MacroAgentFields {
  commandId: string;
  title: string;
  description: string;
  steps: UserCommandStepInput[];
}

export interface UpdateUserCommandInput extends MacroAgentFields {
  commandId: string;
  title: string;
  description: string;
  steps: UserCommandStepInput[];
  isEnabled: boolean;
}

export interface DeleteUserCommandInput {
  commandId: string;
}
