// These types mirror the backend GraphQL schema for commands and keybinds.
// When codegen runs, the generated SDK will provide the canonical types.
// These local types allow development without a running backend.

export type CommandSurface = "Palette" | "ContextMenu" | "KeybindPicker";

export type CommandSourceKind = "BuiltIn" | "Plugin" | "Integration" | "User";

export type CommandExecutionTarget = "Backend" | "DesktopLocal";

export type KeybindContext =
  | "Global"
  | "Composer"
  | "MessageList"
  | "ThreadView"
  | "ConversationView"
  | "Panel"
  | "CommandPalette";

export type KeybindScope = "User" | "Workspace";

export type KeybindSource = "Default" | "User" | "Workspace";

export type CommandResultStatus = "Success" | "Error";

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

export interface CommandResult {
  status: CommandResultStatus;
  message: string;
  payload: unknown;
  followUpCommands: string[];
}

export interface ExecuteCommandInput {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: CommandContextInput;
  confirmedDangerous?: boolean;
}

export interface CommandContextInput {
  workspaceId?: string;
  conversationId?: string;
  threadId?: string;
  selectedText?: string;
  selectedMessageId?: string;
  selectedMessageIds?: string[];
  focusedSurface?: string;
  activePanel?: string;
}

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
}

export interface CreateUserCommandInput {
  commandId: string;
  title: string;
  description: string;
  steps: UserCommandStepInput[];
}

export interface UpdateUserCommandInput {
  commandId: string;
  title: string;
  description: string;
  steps: UserCommandStepInput[];
  isEnabled: boolean;
}

export interface DeleteUserCommandInput {
  commandId: string;
}
