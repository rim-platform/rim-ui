/**
 * The text rules of encrypted content as the webview needs them: mentions are `<@principalId>`
 * tokens (the server maps the authenticated mention list to users), and keywords match whole
 * words outside those tokens.
 */

const MENTION_TOKEN = /<@([^>]*)>/g;

/**
 * The body with each `@<name>` of `mentions` (name to user id) as the token `tokenOf` gives
 * that user, longest name first, so `@kuba:example.org` is not read as `@kuba`. A name followed
 * by more of a name or a domain (`@kuba_2`, `@kuba:example.org` for `kuba`) is left alone.
 *
 * @param mentions - The text after `@` that names each user: a username or a handle.
 * @param tokenOf - The token for a user, or `null` to leave their mentions as they are.
 */
export function replaceMentions(
  body: string,
  mentions: ReadonlyMap<string, string>,
  tokenOf: (userId: string) => string | null,
): string {
  let out = body;
  const names = [...mentions.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const token = tokenOf(mentions.get(name) as string);
    if (token === null) continue;
    const pattern = new RegExp(`@${escapeRegExp(name)}(?![A-Za-z0-9_-]|[.:][A-Za-z0-9])`, "g");
    out = out.replace(pattern, () => token);
  }
  return out;
}

/**
 * The body with `@username` and `@username:domain` mentions as `<@principalId>` tokens, for
 * members that have one.
 */
export function toPrincipalMentions(
  body: string,
  mentions: ReadonlyMap<string, string>,
  principalOf: (userId: string) => string | null | undefined,
): string {
  const out = replaceMentions(body, mentions, (userId) => {
    const principal = principalOf(userId);
    return principal ? `<@${principal}>` : null;
  });
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
