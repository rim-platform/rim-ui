/**
 * Pre/post-processes mention tokens (`<@userId>`) around markdown rendering.
 *
 * Flow:
 *  1. `preprocessMentions` — replaces `<@userId>` with safe placeholders before markdown
 *  2. Markdown renders normally
 *  3. `postprocessMentions` — replaces placeholders with styled mention spans
 */

interface MentionEntry {
  userId: string;
  displayName: string;
}

const MENTION_TOKEN_RE = /<@([a-zA-Z0-9_-]+)>/g;

export function preprocessMentions(
  text: string,
  memberMap: Map<string, string>, // userId → displayName
): { text: string; mentions: MentionEntry[] } {
  const mentions: MentionEntry[] = [];
  let index = 0;

  const processed = text.replace(MENTION_TOKEN_RE, (_match, userId: string) => {
    const displayName = memberMap.get(userId) ?? userId.slice(0, 8);
    mentions.push({ userId, displayName });
    const placeholder = `%%MENTION_${index}%%`;
    index++;
    return placeholder;
  });

  return { text: processed, mentions };
}

export function postprocessMentions(html: string, mentions: MentionEntry[]): string {
  let result = html;
  for (let i = 0; i < mentions.length; i++) {
    const placeholder = `%%MENTION_${i}%%`;
    const mention = mentions[i];
    const span = `<span class="mention text-rim-accent font-medium cursor-pointer rounded px-0.5 -mx-0.5 bg-rim-accent/10 hover:bg-rim-accent/20 transition-colors" data-user-id="${mention.userId}" tabindex="0" role="button">@${escapeHtml(mention.displayName)}</span>`;
    result = result.replace(placeholder, span);
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
