/**
 * The text rules of encrypted content as the webview needs them: mentions are `<@principalId>`
 * tokens (the server maps the authenticated mention list to users), and keywords match whole
 * words outside those tokens.
 */

const MENTION_TOKEN = /<@([^>]*)>/g;

/** The body with `@username` mentions as `<@principalId>` tokens, for members that have one. */
export function toPrincipalMentions(
  body: string,
  mentions: Map<string, string>,
  principalOf: (userId: string) => string | null | undefined,
): string {
  let out = body;
  for (const [username, userId] of mentions) {
    const principal = principalOf(userId);
    if (principal) out = out.split(`@${username}`).join(`<@${principal}>`);
  }
  // Mentions the composer already wrote as user tokens.
  return out.replace(MENTION_TOKEN, (token, id: string) => {
    const principal = principalOf(id);
    return principal ? `<@${principal}>` : token;
  });
}

/** The body with `<@principalId>` tokens as `<@userId>`, which the timeline renders as names. */
export function toUserMentions(
  body: string,
  userOf: (principalId: string) => string | null | undefined,
): string {
  return body.replace(MENTION_TOKEN, (token, id: string) => {
    const user = userOf(id);
    return user ? `<@${user}>` : token;
  });
}

/** The body with `<@principalId>` tokens as `@name`, for plain-text display. */
export function withMentionNames(
  body: string,
  nameOf: (principalId: string) => string | null | undefined,
): string {
  return body.replace(MENTION_TOKEN, (token, id: string) => {
    const name = nameOf(id);
    return name ? `@${name}` : token;
  });
}

/** The principal ids a body mentions, in order of first appearance. */
export function mentionedPrincipals(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = match[1];
    if (id.startsWith("rimp1_") && !out.includes(id)) out.push(id);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `word` occurs in `text` as a whole word, case-insensitively. */
function containsWord(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}($|[^\\p{L}\\p{N}_])`, "iu");
  return pattern.test(text);
}

/** The body without its `<@…>` tokens. */
function withoutMentionTokens(body: string): string {
  return body.replace(MENTION_TOKEN, " ");
}

/** The first of `keywords` the body contains as a whole word outside mention tokens. */
export function matchingKeyword(body: string, keywords: string[]): string | null {
  const text = withoutMentionTokens(body);
  return keywords.find((k) => k.trim() && containsWord(text, k.trim())) ?? null;
}
