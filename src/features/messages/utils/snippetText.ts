/** Marks the start of a highlighted match inside snippet text (a private-use character). */
export const HIGHLIGHT_START = "\uE000";
/** Marks the end of a highlighted match inside snippet text (a private-use character). */
export const HIGHLIGHT_END = "\uE001";

/**
 * Turns a Markdown message excerpt into plain text: drops code fences with their info string,
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
