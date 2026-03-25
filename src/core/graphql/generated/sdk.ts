import { GraphQLClient, RequestOptions } from 'graphql-request';
import gql from 'graphql-tag';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: any; output: any; }
  JSON: { input: any; output: any; }
};

export type AcceptInviteInput = {
  inviteToken: Scalars['String']['input'];
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type AcceptInvitePayload = {
  __typename?: 'AcceptInvitePayload';
  serverId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

export type Action = {
  __typename?: 'Action';
  capabilityIds: Array<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type Attachment = {
  __typename?: 'Attachment';
  contentType: Scalars['String']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sizeBytes: Scalars['Int']['output'];
  status: AttachmentStatusEnum;
};

export enum AttachmentStatusEnum {
  PendingUpload = 'PENDING_UPLOAD',
  Ready = 'READY'
}

export type BootstrapInput = {
  password: Scalars['String']['input'];
  secret: Scalars['String']['input'];
  serverName: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type BootstrapPayload = {
  __typename?: 'BootstrapPayload';
  serverId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

export type Capability = {
  __typename?: 'Capability';
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type ChannelCursorInput = {
  conversationId: Scalars['ID']['input'];
  createdAt: Scalars['DateTime']['input'];
};

export type ChannelCursorOutput = {
  __typename?: 'ChannelCursorOutput';
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
};

export type ChannelPage = {
  __typename?: 'ChannelPage';
  items: Array<Conversation>;
  next?: Maybe<ChannelCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<ChannelCursorOutput>;
};

export type Command = {
  __typename?: 'Command';
  category: Scalars['String']['output'];
  dangerous: Scalars['Boolean']['output'];
  description: Scalars['String']['output'];
  executionTarget: CommandExecutionTarget;
  id: Scalars['String']['output'];
  keybindCapable: Scalars['Boolean']['output'];
  requiredCapabilities: Array<Scalars['String']['output']>;
  requiredContext: Array<Scalars['String']['output']>;
  sourceKind: CommandSourceKind;
  title: Scalars['String']['output'];
  visibleInContextMenus: Scalars['Boolean']['output'];
  visibleInPalette: Scalars['Boolean']['output'];
};

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
  Backend = 'BACKEND',
  DesktopLocal = 'DESKTOP_LOCAL'
}

export type CommandResult = {
  __typename?: 'CommandResult';
  followUpCommands: Array<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
  status: CommandResultStatus;
};

export enum CommandResultStatus {
  Error = 'ERROR',
  Success = 'SUCCESS'
}

export enum CommandSourceKind {
  BuiltIn = 'BUILT_IN',
  Integration = 'INTEGRATION',
  Plugin = 'PLUGIN',
  User = 'USER'
}

export enum CommandSurface {
  ContextMenu = 'CONTEXT_MENU',
  KeybindPicker = 'KEYBIND_PICKER',
  Palette = 'PALETTE'
}

export type Conversation = {
  __typename?: 'Conversation';
  conversationType: ConversationTypeEnum;
  id: Scalars['ID']['output'];
  memberIds: Array<Scalars['ID']['output']>;
  serverId: Scalars['ID']['output'];
  title?: Maybe<Scalars['String']['output']>;
};

export type ConversationPage = {
  __typename?: 'ConversationPage';
  items: Array<Conversation>;
  next?: Maybe<InboxCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<InboxCursorOutput>;
};

export enum ConversationTypeEnum {
  Channel = 'CHANNEL',
  Direct = 'DIRECT',
  Group = 'GROUP'
}

export type CreateAttachmentInput = {
  contentType: Scalars['String']['input'];
  conversationId: Scalars['ID']['input'];
  filename: Scalars['String']['input'];
  messageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  sizeBytes: Scalars['Int']['input'];
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

export type CreateInviteInput = {
  expiresAt?: InputMaybe<Scalars['DateTime']['input']>;
  maxUses?: InputMaybe<Scalars['Int']['input']>;
  serverId: Scalars['ID']['input'];
};

export type CreateInvitePayload = {
  __typename?: 'CreateInvitePayload';
  inviteId: Scalars['ID']['output'];
  inviteToken: Scalars['String']['output'];
};

export type CreateServerInput = {
  name: Scalars['String']['input'];
};

export type CreateKeybindInput = {
  commandId: Scalars['String']['input'];
  context: KeybindContext;
  keystroke: Scalars['String']['input'];
  presetArgs?: InputMaybe<Scalars['JSON']['input']>;
  scope: KeybindScope;
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateThreadInput = {
  conversationId: Scalars['ID']['input'];
  rootMessageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type CreateUserCommandInput = {
  commandId: Scalars['String']['input'];
  description: Scalars['String']['input'];
  steps: Array<UserCommandStepInput>;
  title: Scalars['String']['input'];
};

export type DefaultKeybind = {
  __typename?: 'DefaultKeybind';
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

export type EditMessageInput = {
  conversationId: Scalars['ID']['input'];
  messageId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type Event = {
  __typename?: 'Event';
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type ExecuteCommandInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandContext?: InputMaybe<CommandContextInput>;
  commandId: Scalars['String']['input'];
  confirmedDangerous?: InputMaybe<Scalars['Boolean']['input']>;
};

export type FinalizeAttachmentInput = {
  attachmentId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};

export type InboxCursorInput = {
  conversationId: Scalars['ID']['input'];
  lastActivityAt: Scalars['DateTime']['input'];
};

export type InboxCursorOutput = {
  __typename?: 'InboxCursorOutput';
  conversationId: Scalars['ID']['output'];
  lastActivityAt: Scalars['DateTime']['output'];
};

export type Integration = {
  __typename?: 'Integration';
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  kind: IntegrationKind;
  principalId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
};

export enum IntegrationKind {
  Bot = 'BOT',
  BuiltIn = 'BUILT_IN',
  LocalPlugin = 'LOCAL_PLUGIN',
  Webhook = 'WEBHOOK'
}

export type Keybind = {
  __typename?: 'Keybind';
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
  CommandPalette = 'COMMAND_PALETTE',
  Composer = 'COMPOSER',
  ConversationView = 'CONVERSATION_VIEW',
  Global = 'GLOBAL',
  MessageList = 'MESSAGE_LIST',
  Panel = 'PANEL',
  ThreadView = 'THREAD_VIEW'
}

export type KeybindLayers = {
  __typename?: 'KeybindLayers';
  defaultKeybind?: Maybe<DefaultKeybind>;
  resolvedPersistedKeybind?: Maybe<Keybind>;
  userKeybind?: Maybe<Keybind>;
  workspaceKeybind?: Maybe<Keybind>;
};

export enum KeybindScope {
  User = 'USER',
  Workspace = 'WORKSPACE'
}

export enum KeybindSource {
  Default = 'DEFAULT',
  User = 'USER',
  Workspace = 'WORKSPACE'
}

export type LoginInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type LoginPayload = {
  __typename?: 'LoginPayload';
  userId: Scalars['ID']['output'];
};

export type Message = {
  __typename?: 'Message';
  attachments: Array<Attachment>;
  authorId: Scalars['ID']['output'];
  conversationId: Scalars['ID']['output'];
  hasAttachments: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isDeleted: Scalars['Boolean']['output'];
  parentMessageId?: Maybe<Scalars['ID']['output']>;
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
  __typename?: 'MessageCursorOutput';
  messageId: Scalars['ID']['output'];
  sentAt: Scalars['DateTime']['output'];
};

export type MessagePage = {
  __typename?: 'MessagePage';
  items: Array<Message>;
  next?: Maybe<MessageCursorOutput>;
  pageInfo: PageInfo;
  prev?: Maybe<MessageCursorOutput>;
};

export type MessageReference = {
  __typename?: 'MessageReference';
  anchor: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  permalinkPath: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  acceptInvite: AcceptInvitePayload;
  bootstrap: BootstrapPayload;
  createAttachment: UploadTicket;
  createConversation: Conversation;
  createInvite: CreateInvitePayload;
  createServer: Server;
  createKeybind: Keybind;
  createThread: Thread;
  createUserCommand: Command;
  deleteAttachment: Scalars['Boolean']['output'];
  deleteKeybind: Scalars['Boolean']['output'];
  deleteMessage: Scalars['Boolean']['output'];
  deleteUserCommand: Scalars['Boolean']['output'];
  editMessage: Message;
  executeCommand: CommandResult;
  finalizeAttachment: Attachment;
  login: LoginPayload;
  logout: Scalars['Boolean']['output'];
  sendMessage: Message;
  sendThreadMessage: Message;
  toggleReaction: Array<ReactionGroup>;
  updateKeybind: Keybind;
  updateUserCommand: Command;
};


export type MutationAcceptInviteArgs = {
  input: AcceptInviteInput;
};


export type MutationBootstrapArgs = {
  input: BootstrapInput;
};


export type MutationCreateAttachmentArgs = {
  input: CreateAttachmentInput;
};


export type MutationCreateConversationArgs = {
  input: CreateConversationInput;
};


export type MutationCreateInviteArgs = {
  input: CreateInviteInput;
};


export type MutationCreateServerArgs = {
  input: CreateServerInput;
};


export type MutationCreateKeybindArgs = {
  input: CreateKeybindInput;
};


export type MutationCreateThreadArgs = {
  input: CreateThreadInput;
};


export type MutationCreateUserCommandArgs = {
  input: CreateUserCommandInput;
};


export type MutationDeleteAttachmentArgs = {
  input: DeleteAttachmentInput;
};


export type MutationDeleteKeybindArgs = {
  input: DeleteKeybindInput;
};


export type MutationDeleteMessageArgs = {
  input: DeleteMessageInput;
};


export type MutationDeleteUserCommandArgs = {
  input: DeleteUserCommandInput;
};


export type MutationEditMessageArgs = {
  input: EditMessageInput;
};


export type MutationExecuteCommandArgs = {
  input: ExecuteCommandInput;
};


export type MutationFinalizeAttachmentArgs = {
  input: FinalizeAttachmentInput;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationSendMessageArgs = {
  input: SendMessageInput;
};


export type MutationSendThreadMessageArgs = {
  input: SendThreadMessageInput;
};


export type MutationToggleReactionArgs = {
  input: ToggleReactionInput;
};


export type MutationUpdateKeybindArgs = {
  input: UpdateKeybindInput;
};


export type MutationUpdateUserCommandArgs = {
  input: UpdateUserCommandInput;
};

export enum PageDir {
  After = 'AFTER',
  Before = 'BEFORE'
}

export type PageInfo = {
  __typename?: 'PageInfo';
  hasNext: Scalars['Boolean']['output'];
  hasPrev: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  actions: Array<Action>;
  attachment: Attachment;
  capabilities: Array<Capability>;
  channels: ChannelPage;
  command?: Maybe<Command>;
  commands: Array<Command>;
  conversation: Conversation;
  defaultKeybinds: Array<DefaultKeybind>;
  events: Array<Event>;
  inboxConversations: ConversationPage;
  integrations: Array<Integration>;
  keybindLayers: KeybindLayers;
  keybinds: Array<Keybind>;
  me: User;
  message: Message;
  messageReference: MessageReference;
  messages: MessagePage;
  myServers: Array<Server>;
  resolveKeybind?: Maybe<Keybind>;
  resolvedKeybinds: Array<Keybind>;
  searchMessages: Array<Message>;
  server: Server;
  serverMembers: Array<ServerMember>;
  settings: Array<Setting>;
  thread: Thread;
  threadByRootMessage?: Maybe<Thread>;
  threadMessages: MessagePage;
  threads: ThreadPage;
};


export type QueryAttachmentArgs = {
  attachmentId: Scalars['ID']['input'];
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


export type QueryCommandsArgs = {
  commandContext?: InputMaybe<CommandContextInput>;
  surface?: InputMaybe<CommandSurface>;
};


export type QueryConversationArgs = {
  conversationId: Scalars['ID']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryInboxConversationsArgs = {
  cursor?: InputMaybe<InboxCursorInput>;
  dir: PageDir;
  limit: Scalars['Int']['input'];
  serverId: Scalars['ID']['input'];
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


export type QueryResolveKeybindArgs = {
  context: KeybindContext;
  keystroke: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryResolvedKeybindsArgs = {
  workspaceId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySearchMessagesArgs = {
  conversationId: Scalars['ID']['input'];
  includeDeleted: Scalars['Boolean']['input'];
  limit: Scalars['Int']['input'];
  query: Scalars['String']['input'];
  serverId: Scalars['ID']['input'];
};


export type QueryServerArgs = {
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

export type ReactionGroup = {
  __typename?: 'ReactionGroup';
  count: Scalars['Int']['output'];
  emoji: Scalars['String']['output'];
  reactedByMe: Scalars['Boolean']['output'];
};

export type SendMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};

export type SendThreadMessageInput = {
  conversationId: Scalars['ID']['input'];
  parentMessageId?: InputMaybe<Scalars['ID']['input']>;
  serverId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
  threadId: Scalars['ID']['input'];
};

export type Server = {
  __typename?: 'Server';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type ServerMember = {
  __typename?: 'ServerMember';
  joinedAt: Scalars['DateTime']['output'];
  memberRole: Scalars['String']['output'];
  serverId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

export type Setting = {
  __typename?: 'Setting';
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isSecret: Scalars['Boolean']['output'];
  scope: SettingScope;
  title: Scalars['String']['output'];
  valueType: Scalars['String']['output'];
};

export enum SettingScope {
  DeviceLocal = 'DEVICE_LOCAL',
  Integration = 'INTEGRATION',
  User = 'USER',
  Workspace = 'WORKSPACE'
}

export type Thread = {
  __typename?: 'Thread';
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
  __typename?: 'ThreadCursorOutput';
  lastMessageAt: Scalars['DateTime']['output'];
  threadId: Scalars['ID']['output'];
};

export type ThreadPage = {
  __typename?: 'ThreadPage';
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

export type UpdateKeybindInput = {
  commandId: Scalars['String']['input'];
  context: KeybindContext;
  isEnabled: Scalars['Boolean']['input'];
  keybindId: Scalars['ID']['input'];
  keystroke: Scalars['String']['input'];
  presetArgs?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateUserCommandInput = {
  commandId: Scalars['String']['input'];
  description: Scalars['String']['input'];
  isEnabled: Scalars['Boolean']['input'];
  steps: Array<UserCommandStepInput>;
  title: Scalars['String']['input'];
};

export type UploadTicket = {
  __typename?: 'UploadTicket';
  attachmentId: Scalars['ID']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  maxSizeBytes?: Maybe<Scalars['Int']['output']>;
  uploadToken: Scalars['String']['output'];
};

export type User = {
  __typename?: 'User';
  avatarUrl?: Maybe<Scalars['String']['output']>;
  displayName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  statusText?: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
};

export type UserCommandStepInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  commandId: Scalars['String']['input'];
};

export type BootstrapMutationVariables = Exact<{
  input: BootstrapInput;
}>;


export type BootstrapMutation = { __typename?: 'Mutation', bootstrap: { __typename?: 'BootstrapPayload', userId: string, serverId: string } };

export type CreateServerMutationVariables = Exact<{
  input: CreateServerInput;
}>;


export type CreateServerMutation = { __typename?: 'Mutation', createServer: { __typename?: 'Server', id: string, name: string } };

export type CreateConversationMutationVariables = Exact<{
  input: CreateConversationInput;
}>;


export type CreateConversationMutation = { __typename?: 'Mutation', createConversation: { __typename?: 'Conversation', id: string, title?: string | null, conversationType: ConversationTypeEnum, memberIds: Array<string>, serverId: string } };

export type CreateThreadMutationVariables = Exact<{
  input: CreateThreadInput;
}>;


export type CreateThreadMutation = { __typename?: 'Mutation', createThread: { __typename?: 'Thread', id: string, serverId: string, conversationId: string, rootMessageId?: string | null, rootAuthorId?: string | null, rootText?: string | null, createdAt: any, lastMessageAt: any } };

export type LoginMutationVariables = Exact<{
  input: LoginInput;
}>;


export type LoginMutation = { __typename?: 'Mutation', login: { __typename?: 'LoginPayload', userId: string } };

export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutMutation = { __typename?: 'Mutation', logout: boolean };

export type SendMessageMutationVariables = Exact<{
  input: SendMessageInput;
}>;


export type SendMessageMutation = { __typename?: 'Mutation', sendMessage: { __typename?: 'Message', id: string, serverId: string, conversationId: string, threadId?: string | null, rootThreadId?: string | null, authorId: string, text?: string | null, hasAttachments: boolean, parentMessageId?: string | null, isDeleted: boolean, sentAt: any } };

export type SendThreadMessageMutationVariables = Exact<{
  input: SendThreadMessageInput;
}>;


export type SendThreadMessageMutation = { __typename?: 'Mutation', sendThreadMessage: { __typename?: 'Message', id: string, serverId: string, conversationId: string, threadId?: string | null, rootThreadId?: string | null, authorId: string, text?: string | null, hasAttachments: boolean, parentMessageId?: string | null, isDeleted: boolean, sentAt: any } };

export type InboxConversationsQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
  dir: PageDir;
  limit: Scalars['Int']['input'];
}>;


export type InboxConversationsQuery = { __typename?: 'Query', inboxConversations: { __typename?: 'ConversationPage', items: Array<{ __typename?: 'Conversation', id: string, serverId: string, conversationType: ConversationTypeEnum, title?: string | null, memberIds: Array<string> }>, pageInfo: { __typename?: 'PageInfo', hasNext: boolean, hasPrev: boolean } } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me: { __typename?: 'User', id: string, username: string, displayName?: string | null, avatarUrl?: string | null, statusText?: string | null } };

export type MessagesQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
  conversationId: Scalars['ID']['input'];
  dir: PageDir;
  limit: Scalars['Int']['input'];
  includeDeleted: Scalars['Boolean']['input'];
}>;


export type MessagesQuery = { __typename?: 'Query', messages: { __typename?: 'MessagePage', items: Array<{ __typename?: 'Message', id: string, serverId: string, conversationId: string, threadId?: string | null, rootThreadId?: string | null, authorId: string, text?: string | null, hasAttachments: boolean, parentMessageId?: string | null, isDeleted: boolean, sentAt: any }>, pageInfo: { __typename?: 'PageInfo', hasNext: boolean, hasPrev: boolean } } };

export type MyServersQueryVariables = Exact<{ [key: string]: never; }>;


export type MyServersQuery = { __typename?: 'Query', myServers: Array<{ __typename?: 'Server', id: string, name: string }> };

export type ServerMembersQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
}>;


export type ServerMembersQuery = { __typename?: 'Query', serverMembers: Array<{ __typename?: 'ServerMember', userId: string, memberRole: string, joinedAt: any }> };

export type ServerQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
}>;


export type ServerQuery = { __typename?: 'Query', server: { __typename?: 'Server', id: string, name: string } };

export type ThreadByRootMessageQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
  conversationId: Scalars['ID']['input'];
  rootMessageId: Scalars['ID']['input'];
}>;


export type ThreadByRootMessageQuery = { __typename?: 'Query', threadByRootMessage?: { __typename?: 'Thread', id: string, serverId: string, conversationId: string, rootMessageId?: string | null, rootAuthorId?: string | null, rootText?: string | null, createdAt: any, lastMessageAt: any } | null };

export type ThreadMessagesQueryVariables = Exact<{
  serverId: Scalars['ID']['input'];
  conversationId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
  dir: PageDir;
  limit: Scalars['Int']['input'];
  includeDeleted: Scalars['Boolean']['input'];
}>;


export type ThreadMessagesQuery = { __typename?: 'Query', threadMessages: { __typename?: 'MessagePage', items: Array<{ __typename?: 'Message', id: string, serverId: string, conversationId: string, threadId?: string | null, rootThreadId?: string | null, authorId: string, text?: string | null, hasAttachments: boolean, parentMessageId?: string | null, isDeleted: boolean, sentAt: any }>, pageInfo: { __typename?: 'PageInfo', hasNext: boolean, hasPrev: boolean } } };


export const BootstrapDocument = gql`
    mutation Bootstrap($input: BootstrapInput!) {
  bootstrap(input: $input) {
    userId
    serverId
  }
}
    `;
export const CreateServerDocument = gql`
    mutation CreateServer($input: CreateServerInput!) {
  createServer(input: $input) {
    id
    name
  }
}
    `;
export const CreateConversationDocument = gql`
    mutation CreateConversation($input: CreateConversationInput!) {
  createConversation(input: $input) {
    id
    title
    conversationType
    memberIds
    serverId
  }
}
    `;
export const CreateThreadDocument = gql`
    mutation CreateThread($input: CreateThreadInput!) {
  createThread(input: $input) {
    id
    serverId
    conversationId
    rootMessageId
    rootAuthorId
    rootText
    createdAt
    lastMessageAt
  }
}
    `;
export const LoginDocument = gql`
    mutation Login($input: LoginInput!) {
  login(input: $input) {
    userId
  }
}
    `;
export const LogoutDocument = gql`
    mutation Logout {
  logout
}
    `;
export const SendMessageDocument = gql`
    mutation SendMessage($input: SendMessageInput!) {
  sendMessage(input: $input) {
    id
    serverId
    conversationId
    threadId
    rootThreadId
    authorId
    text
    hasAttachments
    parentMessageId
    isDeleted
    sentAt
  }
}
    `;
export const SendThreadMessageDocument = gql`
    mutation SendThreadMessage($input: SendThreadMessageInput!) {
  sendThreadMessage(input: $input) {
    id
    serverId
    conversationId
    threadId
    rootThreadId
    authorId
    text
    hasAttachments
    parentMessageId
    isDeleted
    sentAt
  }
}
    `;
export const InboxConversationsDocument = gql`
    query InboxConversations($serverId: ID!, $dir: PageDir!, $limit: Int!) {
  inboxConversations(serverId: $serverId, dir: $dir, limit: $limit) {
    items {
      id
      serverId
      conversationType
      title
      memberIds
    }
    pageInfo {
      hasNext
      hasPrev
    }
  }
}
    `;
export const MeDocument = gql`
    query Me {
  me {
    id
    username
    displayName
    avatarUrl
    statusText
  }
}
    `;
export const MessagesDocument = gql`
    query Messages($serverId: ID!, $conversationId: ID!, $dir: PageDir!, $limit: Int!, $includeDeleted: Boolean!) {
  messages(
    serverId: $serverId
    conversationId: $conversationId
    dir: $dir
    limit: $limit
    includeDeleted: $includeDeleted
  ) {
    items {
      id
      serverId
      conversationId
      threadId
      rootThreadId
      authorId
      text
      hasAttachments
      parentMessageId
      isDeleted
      sentAt
    }
    pageInfo {
      hasNext
      hasPrev
    }
  }
}
    `;
export const MyServersDocument = gql`
    query MyServers {
  myServers {
    id
    name
  }
}
    `;
export const ServerMembersDocument = gql`
    query ServerMembers($serverId: ID!) {
  serverMembers(serverId: $serverId) {
    userId
    memberRole
    joinedAt
  }
}
    `;
export const ServerDocument = gql`
    query Server($serverId: ID!) {
  server(serverId: $serverId) {
    id
    name
  }
}
    `;
export const ThreadByRootMessageDocument = gql`
    query ThreadByRootMessage($serverId: ID!, $conversationId: ID!, $rootMessageId: ID!) {
  threadByRootMessage(
    serverId: $serverId
    conversationId: $conversationId
    rootMessageId: $rootMessageId
  ) {
    id
    serverId
    conversationId
    rootMessageId
    rootAuthorId
    rootText
    createdAt
    lastMessageAt
  }
}
    `;
export const ThreadMessagesDocument = gql`
    query ThreadMessages($serverId: ID!, $conversationId: ID!, $threadId: ID!, $dir: PageDir!, $limit: Int!, $includeDeleted: Boolean!) {
  threadMessages(
    serverId: $serverId
    conversationId: $conversationId
    threadId: $threadId
    dir: $dir
    limit: $limit
    includeDeleted: $includeDeleted
  ) {
    items {
      id
      serverId
      conversationId
      threadId
      rootThreadId
      authorId
      text
      hasAttachments
      parentMessageId
      isDeleted
      sentAt
    }
    pageInfo {
      hasNext
      hasPrev
    }
  }
}
    `;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    Bootstrap(variables: BootstrapMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<BootstrapMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<BootstrapMutation>({ document: BootstrapDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Bootstrap', 'mutation', variables);
    },
    CreateServer(variables: CreateServerMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateServerMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateServerMutation>({ document: CreateServerDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'CreateServer', 'mutation', variables);
    },
    CreateConversation(variables: CreateConversationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateConversationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateConversationMutation>({ document: CreateConversationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'CreateConversation', 'mutation', variables);
    },
    CreateThread(variables: CreateThreadMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateThreadMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateThreadMutation>({ document: CreateThreadDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'CreateThread', 'mutation', variables);
    },
    Login(variables: LoginMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<LoginMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<LoginMutation>({ document: LoginDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Login', 'mutation', variables);
    },
    Logout(variables?: LogoutMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<LogoutMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<LogoutMutation>({ document: LogoutDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Logout', 'mutation', variables);
    },
    SendMessage(variables: SendMessageMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<SendMessageMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<SendMessageMutation>({ document: SendMessageDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'SendMessage', 'mutation', variables);
    },
    SendThreadMessage(variables: SendThreadMessageMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<SendThreadMessageMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<SendThreadMessageMutation>({ document: SendThreadMessageDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'SendThreadMessage', 'mutation', variables);
    },
    InboxConversations(variables: InboxConversationsQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<InboxConversationsQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<InboxConversationsQuery>({ document: InboxConversationsDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'InboxConversations', 'query', variables);
    },
    Me(variables?: MeQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<MeQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<MeQuery>({ document: MeDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Me', 'query', variables);
    },
    Messages(variables: MessagesQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<MessagesQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<MessagesQuery>({ document: MessagesDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Messages', 'query', variables);
    },
    MyServers(variables?: MyServersQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<MyServersQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<MyServersQuery>({ document: MyServersDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'MyServers', 'query', variables);
    },
    ServerMembers(variables: ServerMembersQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ServerMembersQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ServerMembersQuery>({ document: ServerMembersDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'ServerMembers', 'query', variables);
    },
    Server(variables: ServerQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ServerQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ServerQuery>({ document: ServerDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'Server', 'query', variables);
    },
    ThreadByRootMessage(variables: ThreadByRootMessageQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ThreadByRootMessageQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ThreadByRootMessageQuery>({ document: ThreadByRootMessageDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'ThreadByRootMessage', 'query', variables);
    },
    ThreadMessages(variables: ThreadMessagesQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ThreadMessagesQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ThreadMessagesQuery>({ document: ThreadMessagesDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'ThreadMessages', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;