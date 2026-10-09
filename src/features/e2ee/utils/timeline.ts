/**
 * The timeline of an encrypted conversation as it is shown: messages this device cannot read
 * (sent before it joined, or in an older incarnation) collapse into one line, the moment the
 * conversation became encrypted is marked, each new incarnation says who reset the encryption,
 * members added and removed by the Commits this device processed get a line where the Commit
 * took effect, older plaintext messages carry a quiet "sent before encryption" note, mentions
 * read as names, and a decrypted message is shown as its MLS sender's, whoever the server names
 * as its author.
 */

import type { MessageAuthor, MessageItem } from "../../../core/types/messages";
import type { MembershipEvent, Reset } from "../api/e2eeCommands";
import { toUserMentions } from "./content";

export type E2eeNotice =
  | { kind: "earlier"; count: number }
  | { kind: "encryptedFrom" }
  | { kind: "reset"; incarnation: number; principalId: string | null; deviceId: string | null }
  | { kind: "member"; change: "added" | "removed"; principalId: string };

/** A timeline item: a message, or one of the encryption notices between messages. */
export interface TimelineMessage extends MessageItem {
  e2eeNotice?: E2eeNotice;
  /** A plaintext message sent before the conversation was encrypted. */
  beforeEncryption?: boolean;
}

export interface EncryptionContext {
  encryptedAt: string | null;
  resets: Reset[];
  /** Principals added and removed by processed Commits, oldest first. */
  membership?: MembershipEvent[];
  userOfPrincipal: (principalId: string) => string | undefined;
}

/**
 * A decrypted message as its MLS sender's: the member whose principal sent it, not the author
 * the server's row names (the two can differ only when the server lies about the author).
 */
export function withSenderAsAuthor<T extends { authorId: string; author: unknown }>(
  item: T,
  userOfPrincipal: (principalId: string) => string | undefined,
): T {
  const e2ee = (item as { e2ee?: MessageItem["e2ee"] }).e2ee;
  const sender = e2ee?.status === "decrypted" ? e2ee.senderPrincipalId : undefined;
  if (!sender) return item;
  const userId = userOfPrincipal(sender);
  if (userId === item.authorId) return item;
  const author: MessageAuthor = {
    id: userId ?? sender,
    username: "",
    displayName: userId ? null : "Unknown member",
    avatarUrl: null,
    principalId: sender,
  };
  return { ...item, authorId: author.id, author };
}

/** Where a message or a Commit sits in a conversation's encrypted history. */
function position(incarnation: number, epoch: number): number {
  return incarnation * 2 ** 32 + epoch;
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
  // Membership lines go before the first message at or after the epoch their Commit made, once
  // a message before it is loaded (one before every loaded message belongs to an older page).
  const membership = [...(context.membership ?? [])].sort(
    (a, b) => position(a.incarnation, a.epoch) - position(b.incarnation, b.epoch),
  );
  let nextEvent = 0;
  let lastPosition: number | null = null;
  const placeMembership = (until: number, sentAt: string) => {
    while (nextEvent < membership.length) {
      const event = membership[nextEvent];
      const at = position(event.incarnation, event.epoch);
      if (at > until) return;
      nextEvent += 1;
      if (lastPosition === null || at <= lastPosition) continue;
      out.push(
        notice(
          `e2ee-notice:member:${event.incarnation}:${event.epoch}:${event.principalId}:${event.kind}`,
          sentAt,
          {
            kind: "member",
            change: event.kind,
            principalId: event.principalId,
          },
        ),
      );
      earlier = null;
    }
  };

  const placeMarker = (sentAt: string) => {
    if (markerPlaced) return;
    markerPlaced = true;
    out.push(notice("e2ee-notice:encrypted", sentAt, { kind: "encryptedFrom" }));
  };

  for (const item of items) {
    const sentAt = Date.parse(item.sentAt);
    if (!markerPlaced && sentAt >= encryptedFrom) placeMarker(item.sentAt);

    const seen = item.e2ee?.incarnation;
    const seenEpoch = item.e2ee?.epoch;
    if (seen !== undefined && seenEpoch !== undefined) {
      const at = position(seen, seenEpoch);
      placeMembership(at, item.sentAt);
      lastPosition = Math.max(lastPosition ?? at, at);
    }
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

    if (item.e2ee?.status === "decrypted") {
      const shown = withSenderAsAuthor(item, context.userOfPrincipal);
      out.push(
        item.text ? { ...shown, text: toUserMentions(item.text, context.userOfPrincipal) } : shown,
      );
    } else if (!item.e2ee && !item.encryption && sentAt < encryptedFrom) {
      out.push({ ...item, beforeEncryption: true });
    } else {
      out.push(item);
    }
  }
  const last = items[items.length - 1];
  if (last) placeMembership(Number.POSITIVE_INFINITY, last.sentAt);
  if (!markerPlaced && out.length > 0) placeMarker(encryptedAt);
  return out;
}
