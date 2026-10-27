/** A run of backtick-quoted code on one line. */
export const INLINE_CODE = /`([^`\n]+)`/g;

/** `text` with the backticks around its code runs removed, for a plain-text title. */
export function withoutCodeMarks(text: string): string {
  return text.replace(INLINE_CODE, "$1");
}
