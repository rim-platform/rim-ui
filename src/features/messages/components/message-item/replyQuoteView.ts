import type { MessageItemMessage, ReplyQuoteView } from "./types";

const EXCERPT_MAX = 140;
const FENCE = /^(?:`{3,}|~{3,})/;

/**
 * The first line of a Markdown text as plain text: quote, heading and list markers, link
 * syntax and emphasis removed, `<@userId>` mentions shown as `@name`, long lines shortened.
 */
export function plainFirstLine(
  text: string,
  nameOf?: (userId: string) => string | undefined,
): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !FENCE.test(l)) ?? "";
  const plain = line
    .replace(/^(?:>\s*)+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/<@([a-zA-Z0-9_-]+)>/g, (_m, id: string) => `@${nameOf?.(id) ?? id.slice(0, 8)}`)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|[*`~]/g, "")
    .trim();
  return plain.length > EXCERPT_MAX ? `${plain.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : plain;
}

function parentExcerpt(
  parent: MessageItemMessage,
  nameOf?: (userId: string) => string | undefined,
): string {
  if (parent.isDeleted) return "This message was deleted";
  if (parent.e2ee?.status === "invalid") return "A message that could not be verified";
  if (parent.e2ee?.status === "undecryptable") return "A message this device cannot read";
  const line = parent.text ? plainFirstLine(parent.text, nameOf) : "";
  if (line) return line;
  const attachment = parent.attachments?.[0];
  return attachment ? attachment.filename : "Message";
}

/**
 * The quote a reply shows of its parent. `parent` is undefined when the parent is not among
 * the loaded messages; the quote then names neither author nor text.
 */
export function replyQuoteFor(
  parentMessageId: string,
  parent: MessageItemMessage | undefined,
  authorName: string | null,
  nameOf?: (userId: string) => string | undefined,
): ReplyQuoteView {
  if (!parent) {
    return { messageId: parentMessageId, authorName: null, excerpt: "Original message not loaded" };
  }
  return { messageId: parentMessageId, authorName, excerpt: parentExcerpt(parent, nameOf) };
}
