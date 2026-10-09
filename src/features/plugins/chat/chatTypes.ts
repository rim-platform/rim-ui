// The `rim.chat.*` methods of the client message service: names, the capabilities
// they need, and the shapes plugins get. Both plugin hosts answer them through
// `messageService.ts`.

export const ChatMethod = {
  listMessages: "rim.chat.list_messages",
  getMessage: "rim.chat.get_message",
  searchMessages: "rim.chat.search_messages",
  postMessage: "rim.chat.post_message",
} as const;

export type ChatMethodName = (typeof ChatMethod)[keyof typeof ChatMethod];

export const CHAT_METHODS: readonly string[] = Object.values(ChatMethod);

export function isChatMethod(method: string): method is ChatMethodName {
  return CHAT_METHODS.includes(method);
}

export const CHAT_READ = "chat.read";
export const CHAT_WRITE = "chat.write";
export const CHAT_READ_ENCRYPTED = "chat.read.encrypted";
export const CHAT_WRITE_ENCRYPTED = "chat.write.encrypted";

/** A person as a plugin sees them. */
export interface PluginChatAuthor {
  principalId: string;
  displayName: string;
}

/** An attachment's name, type and size; plugins cannot fetch its bytes. */
export interface PluginChatAttachment {
  name: string;
  mime: string;
  size: number;
}

/** A message as the message service returns it. */
export interface PluginChatMessage {
  id: string;
  conversationId: string;
  threadId: string | null;
  author: PluginChatAuthor;
  text: string;
  sentAt: string;
  editedAt: string | null;
  /** The message itself was end-to-end encrypted. */
  encrypted: boolean;
  attachments: PluginChatAttachment[];
}

/** `rim.chat.list_messages`: a page of a conversation, oldest first. */
export interface PluginMessagePage {
  messages: PluginChatMessage[];
  /** Older messages exist; ask again with `before` the first message's id. */
  hasOlder: boolean;
}

/** What a read may reach, as the cache's plugin commands take it. */
export interface PluginReadScope {
  encryptedAllowed: boolean;
  /** Conversations known to be encrypted beyond what the cache shows. */
  knownEncrypted: string[];
}
