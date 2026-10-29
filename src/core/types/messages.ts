export interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

import { AttachmentStatusEnum, type User } from "../graphql/generated/schema-types";

export type AttachmentStatus = AttachmentStatusEnum;

export interface MessageAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  /** SHA-256 of an encrypted attachment's blob (base64url). */
  blobSha256?: string | null;
}

export interface MessageAuthor extends Partial<Pick<User, "banned" | "bannedUntil" | "banReason">> {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  principalId?: string | null;
  /** `@<username>:<domain>`; null when the server does not know it. */
  handle?: string | null;
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

/** The envelope facts the server keeps about an encrypted message. */
export interface MessageEncryptionFacts {
  incarnation: number;
  epoch: number;
  senderDeviceId: string;
  frankingReceipt: string;
  frankingKeyId: number;
  sentAtUs: string;
  ciphertext?: string | null;
}

/**
 * What the desktop's message cache keeps about an encrypted message: whether this device could
 * read it, and what a report or the archive needs (`content` is the exact decrypted content).
 */
export interface MessageE2ee {
  /** `undecryptable`: sent before this device joined; `invalid`: decrypted but breaks a rule. */
  status: "decrypted" | "undecryptable" | "invalid";
  incarnation: number;
  epoch: number;
  senderDeviceId: string;
  senderPrincipalId?: string;
  receipt?: string | null;
  receiptKeyId?: number | null;
  sentAtUs?: string | null;
  frankingKey?: string;
  rev?: number;
  content?: string;
  reason?: string;
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
  /**
   * When the text last changed; null for a never-edited message, absent when the server does not
   * report it.
   */
  editedAt?: string | null;
  /**
   * Whether the server's automatic check flagged the message and no Owner or Moderator cleared
   * it; absent (not flagged) when the server does not report it.
   */
  flagged?: boolean;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
  linkPreviews: MessageLinkPreview[];
  /** Set on encrypted messages as the server returns them. */
  encryption?: MessageEncryptionFacts | null;
  /** Set on encrypted messages read from the desktop's cache. */
  e2ee?: MessageE2ee | null;
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
