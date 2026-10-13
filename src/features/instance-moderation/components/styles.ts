/** Class names shared by the instance moderation sections. */

export const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

export const PANEL = "rounded-lg border border-rim-line bg-rim-panel p-4";

export const FIELD_LABEL = "mb-1 block text-xs font-medium text-rim-text";

export const TEXT_INPUT =
  "w-full rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

export const BADGE =
  "rounded border border-rim-line px-1 text-[10px] uppercase tracking-wider text-rim-text-faint";

/** The longest reason the server takes for a block. */
export const MAX_REASON_LENGTH = 1000;

/** `n` with `word`, plural when `n` is not 1. */
export function countOf(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
