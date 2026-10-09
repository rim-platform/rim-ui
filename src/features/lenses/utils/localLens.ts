/**
 * A lens applied on this device, for an end-to-end encrypted conversation, whose timeline the
 * server cannot filter. It is metadata-only for encrypted messages: a condition that reads
 * message text (text contains, has links) never matches one, whatever it asks for.
 */

import type { MessageItem } from "../../../core/types/messages";
import { FilterField, FilterLogic } from "../../../core/graphql/generated/schema-types";
import type { FilterCondition, FilterSpec } from "../api/useLenses";

const LINK = /https?:\/\//i;

/** Shown under conditions that read message text. */
export const ENCRYPTED_TEXT_NOTE =
  "Text and link conditions never match messages in end-to-end encrypted DMs and groups: only their metadata is matched.";

/** Conditions that read a message's text. */
export const TEXT_FIELDS: readonly FilterField[] = [
  FilterField.TEXT_CONTAINS,
  FilterField.HAS_LINKS,
];

/** Whether the message was end-to-end encrypted, as the cache or the server marks it. */
export function isEncryptedMessage(message: MessageItem): boolean {
  return Boolean(message.e2ee || message.encryption);
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function conditionMatches(message: MessageItem, condition: FilterCondition): boolean {
  if (TEXT_FIELDS.includes(condition.field) && isEncryptedMessage(message)) return false;
  const value: unknown = condition.value;
  switch (condition.field) {
    case FilterField.AUTHOR_ID:
      return asStrings(value).includes(message.authorId);
    case FilterField.HAS_ATTACHMENTS:
      return message.hasAttachments === (value !== false);
    case FilterField.IS_PINNED:
      return message.isPinned === (value !== false);
    case FilterField.HAS_LINKS:
      return LINK.test(message.text) === (value !== false);
    case FilterField.TEXT_CONTAINS: {
      const needle = typeof value === "string" ? value.toLowerCase() : "";
      return needle.length > 0 && message.text.toLowerCase().includes(needle);
    }
  }
}

export function lensMatches(message: MessageItem, spec: FilterSpec): boolean {
  if (spec.conditions.length === 0) return true;
  const results = spec.conditions.map((c) => conditionMatches(message, c));
  return spec.logic === FilterLogic.OR ? results.some(Boolean) : results.every(Boolean);
}

/** The messages of `items` the lens shows, in order. */
export function applyLensLocally(items: readonly MessageItem[], spec: FilterSpec): MessageItem[] {
  return items.filter((m) => !m.isDeleted && lensMatches(m, spec));
}
