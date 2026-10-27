/** Marks the start of a highlighted match inside snippet text (a private-use character). */
export const HIGHLIGHT_START = "\uE000";
/** Marks the end of a highlighted match inside snippet text (a private-use character). */
export const HIGHLIGHT_END = "\uE001";

/** A code fence, closed or running to the end, or an inline code span. */
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;
/** Any character but a highlight sentinel. */
const NOT_SENTINEL = new RegExp(`[^${HIGHLIGHT_START}${HIGHLIGHT_END}]`, "g");

/**
 * Drops all of `match` but the highlight sentinels in it.
 *
 * @param match - the text to drop
 * @returns the highlight sentinels `match` holds, in order
 */
function keepSentinels(match: string): string {
  return match.replace(NOT_SENTINEL, "");
}

/**
 * Drops what a Markdown message holds outside code that is not text: HTML tags (and the content
 * of `script` and `style`), table pipes and delimiter rows, task boxes and thematic breaks; an
 * autolink keeps its address. Highlight sentinels inside a dropped tag are kept.
 *
 * @param text - a part of the message outside code
 * @returns the part with that syntax removed
 */
function plainProse(text: string): string {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, keepSentinels)
    .replace(/<((?:https?|mailto):[^<>\s]+)>/gi, "$1")
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, keepSentinels)
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-+:?[ \t]*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_row, inner: string) =>
      inner
        .split("|")
        .map((cell) => cell.trim())
        .join(" "),
    )
    .replace(/^([ \t]*(?:[-*+]|\d+\.)[ \t]+)\[[ xX]\][ \t]+/gm, "$1");
}

/**
 * Turns a Markdown message excerpt into plain text: drops HTML tags, table pipes and delimiter
 * rows, task boxes and thematic breaks outside code, code fences with their info string,
 * backticks, emphasis markers, heading, quote and list markers, keeps the text of links and
 * images, and collapses whitespace to single spaces. Underscores inside words (`snake_case`)
 * stay, and the highlight sentinels {@link HIGHLIGHT_START} and {@link HIGHLIGHT_END} pass
 * through untouched.
 *
 * @param text - the excerpt, possibly cut mid-way through Markdown syntax
 * @returns the excerpt as one line of plain text
 */
export function plainSnippet(text: string): string {
  return text
    .split(CODE_SEGMENT)
    .map((part, i) => (i % 2 === 1 ? part : plainProse(part)))
    .join("")
    .replace(/(```|~~~)[^\s`~]*/g, "")
    .replace(/`/g, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/(^|[\s(])[*_](?=\S)/g, "$1")
    .replace(/(?<=\S)[*_](?=$|[\s).,!?:;])/g, "")
    .replace(/^[ \t]*#{1,6}\s+/gm, "")
    .replace(/^[ \t]*>\s?/gm, "")
    .replace(/^[ \t]*([-*+]|\d+\.)\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTINEL = new RegExp(`[${HIGHLIGHT_START}${HIGHLIGHT_END}]`, "g");
/** A character of a mention token's id, or a highlight sentinel inside it. */
const ID_CHAR = `[\\w${HIGHLIGHT_START}${HIGHLIGHT_END}-]`;
/** A complete mention token, `<@id>`. */
const MENTION_TOKEN = new RegExp(`<@(${ID_CHAR}+)>`, "g");
/**
 * What a cut at the start of an excerpt leaves of a token: its id, or the end of it, and `>`.
 * The id part holds a digit, as user and principal ids do, so a word such as `Note>` stays.
 */
const CUT_TOKEN_START = new RegExp(`^(\\s*…?)((?=${ID_CHAR}*\\d)${ID_CHAR}+)>`);
/** What a cut at the end of an excerpt leaves of a token: `<`, `<@`, or `<@` and part of the id. */
const CUT_TOKEN_END = new RegExp(`<(?:@(${ID_CHAR}*))?(…?\\s*)$`);

/**
 * The text that stands for a mention token's id: the member's `@name`, or `fallback` when the
 * id names no member. A highlight that opens and closes inside the id is dropped; one that
 * only closes inside it closes before the text, one that only opens inside it opens after it.
 *
 * @param rawId - the token's id, with any highlight sentinels in it
 * @param nameOf - a member's display name by the id a mention token carries
 * @param fallback - the text for an id that names no member
 */
function mentionText(
  rawId: string,
  nameOf: (id: string) => string | undefined,
  fallback: string,
): string {
  let open = 0;
  let closes = 0;
  for (const char of rawId) {
    if (char === HIGHLIGHT_START) open++;
    else if (char === HIGHLIGHT_END) {
      if (open > 0) open--;
      else closes++;
    }
  }
  const name = nameOf(rawId.replace(SENTINEL, ""));
  const text = name ? `@${name}` : fallback;
  return `${HIGHLIGHT_END.repeat(closes)}${text}${HIGHLIGHT_START.repeat(open)}`;
}

/**
 * Turns a message, or an excerpt of one, into one line of plain text for a preview: each
 * mention token `<@id>` becomes `@<display name>` (`@member` for an id that names no
 * member), then {@link plainSnippet} removes the Markdown. In an excerpt, what a cut left of a
 * token at either end becomes the member's `@name` when the id is whole and known, and is
 * dropped otherwise. Highlight sentinels pass through as {@link plainSnippet} lets them.
 *
 * @param text - the message text, or an excerpt of it
 * @param nameOf - a member's display name by the id a mention token carries (a user id, or a
 * principal id in an encrypted message); `undefined` when unknown
 * @param options.excerpt - whether `text` may be cut mid-way through a token at either end
 * @returns the text as one line of plain text
 */
export function plainMessagePreview(
  text: string,
  nameOf: (id: string) => string | undefined,
  options: { excerpt?: boolean } = {},
): string {
  let out = text.replace(MENTION_TOKEN, (_token, id: string) => mentionText(id, nameOf, "@member"));
  if (options.excerpt) {
    out = out
      .replace(
        CUT_TOKEN_START,
        (_cut, lead: string, id: string) => lead + mentionText(id, nameOf, ""),
      )
      .replace(
        CUT_TOKEN_END,
        (_cut, id: string | undefined, trail: string) =>
          (id ? mentionText(id, nameOf, "") : "") + trail,
      );
  }
  return plainSnippet(out);
}
