export interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

import { AttachmentStatusEnum } from "../graphql/generated/schema-types";

export type AttachmentStatus = AttachmentStatusEnum;

export interface MessageAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
}

export interface MessageAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ForwardedFrom {
  id: string;
  conversationId: string;
  author: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
}

export interface MessageLinkPreview {
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
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
  isPinned: boolean;
  mentionedUserIds: string[];
  forwardedFromMessageId: string | null;
  forwardedFrom: ForwardedFrom | null;
  isDeleted: boolean;
  sentAt: string;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
  linkPreviews: MessageLinkPreview[];
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
