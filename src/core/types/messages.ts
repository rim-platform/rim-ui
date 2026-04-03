export interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

export interface MessageAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: string;
}

export interface MessageAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface MessageItem {
  id: string;
  serverId: string;
  conversationId: string;
  threadId?: string | null;
  rootThreadId?: string | null;
  authorId: string;
  author: MessageAuthor | null;
  text: string;
  hasAttachments: boolean;
  parentMessageId?: string | null;
  isDeleted: boolean;
  sentAt: string;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
}

export interface MessageCursor {
  sentAt: string;
  messageId: string;
}

export interface MessagesPage {
  items: MessageItem[];
  next: MessageCursor | null;
  prev: MessageCursor | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}
