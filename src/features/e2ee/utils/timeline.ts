/**
 * The timeline of an encrypted conversation as it is shown: messages this device cannot read
 * (sent before it joined, or in an older incarnation) collapse into one line, the moment the
 * conversation became encrypted is marked, each new incarnation says who reset the encryption,
 * older plaintext messages carry a quiet "sent before encryption" note, and mentions read as
 * names.
 */

import type { MessageItem } from "../../../core/types/messages";
import type { Reset } from "../api/e2eeCommands";
import { toUserMentions } from "./content";

export type E2eeNotice =
  | { kind: "earlier"; count: number }
  | { kind: "encryptedFrom" }
  | { kind: "reset"; incarnation: number; principalId: string | null; deviceId: string | null };

/** A timeline item: a message, or one of the encryption notices between messages. */
export interface TimelineMessage extends MessageItem {
  e2eeNotice?: E2eeNotice;
  /** A plaintext message sent before the conversation was encrypted. */
  beforeEncryption?: boolean;
}

export interface EncryptionContext {
  encryptedAt: string | null;
  resets: Reset[];
  userOfPrincipal: (principalId: string) => string | undefined;
}

function notice(id: string, sentAt: string, e2eeNotice: E2eeNotice): TimelineMessage {
  return {
    id,
    serverId: "",
    conversationId: "",
    authorId: "",
    author: null,
    text: "",
    hasAttachments: false,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt,
    reactions: [],
    attachments: [],
    linkPreviews: [],
    e2eeNotice,
  };
}

export function isPlaceholder(message: MessageItem): boolean {
  return message.e2ee?.status === "undecryptable";
}

/** `items` (oldest first) with the encryption notices in place. */
export function withEncryptionNotices(
  items: MessageItem[],
  context: EncryptionContext,
): TimelineMessage[] {
  const { encryptedAt } = context;
  if (!encryptedAt) return items;
  const encryptedFrom = Date.parse(encryptedAt);
  const out: TimelineMessage[] = [];
  let markerPlaced = false;
  let earlier: (TimelineMessage & { e2eeNotice: { kind: "earlier"; count: number } }) | null = null;
  let incarnation: number | null = null;

  const placeMarker = (sentAt: string) => {
    if (markerPlaced) return;
    markerPlaced = true;
    out.push(notice("e2ee-notice:encrypted", sentAt, { kind: "encryptedFrom" }));
  };

  for (const item of items) {
    const sentAt = Date.parse(item.sentAt);
    if (!markerPlaced && sentAt >= encryptedFrom) placeMarker(item.sentAt);

    const seen = item.e2ee?.incarnation;
    if (seen !== undefined) {
      if (incarnation !== null && seen > incarnation) {
        const reset = context.resets.find((r) => r.incarnation === seen);
        out.push(
          notice(`e2ee-notice:reset:${seen}`, item.sentAt, {
            kind: "reset",
            incarnation: seen,
            principalId: reset?.principalId ?? null,
            deviceId: reset?.deviceId ?? null,
          }),
        );
        earlier = null;
      }
      incarnation = Math.max(incarnation ?? seen, seen);
    }

    if (isPlaceholder(item)) {
      if (earlier) {
        earlier.e2eeNotice.count += 1;
      } else {
        earlier = {
          ...notice(`e2ee-notice:earlier:${item.id}`, item.sentAt, { kind: "earlier", count: 1 }),
          e2eeNotice: { kind: "earlier", count: 1 },
        };
        out.push(earlier);
      }
      continue;
    }
    earlier = null;

    if (item.e2ee?.status === "decrypted" && item.text) {
      out.push({ ...item, text: toUserMentions(item.text, context.userOfPrincipal) });
    } else if (!item.e2ee && !item.encryption && sentAt < encryptedFrom) {
      out.push({ ...item, beforeEncryption: true });
    } else {
      out.push(item);
    }
  }
  if (!markerPlaced && out.length > 0) placeMarker(encryptedAt);
  return out;
}
