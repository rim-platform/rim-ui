/** Longest display name the server accepts, after trimming. */
const DISPLAY_NAME_MAX = 80;

/** Why an optional display name is refused, or `null` when it is fine (blank included). */
export function checkDisplayName(value: string): string | null {
  return value.trim().length > DISPLAY_NAME_MAX
    ? `Display name must be at most ${DISPLAY_NAME_MAX} characters.`
    : null;
}
