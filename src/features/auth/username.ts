/** Shortest username the server accepts, in characters after trimming. */
export const USERNAME_MIN = 3;
/** Longest username the server accepts, in characters after trimming. */
export const USERNAME_MAX = 32;

/** What the server lets a username hold: ASCII letters, digits, `_` and `-`. */
const USERNAME_CHARACTERS = /^[A-Za-z0-9_-]+$/;

/** Why a username is refused, in the server's order, or `null` when the server's rules accept it. */
export function usernameProblem(value: string): string | null {
  const name = value.trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_CHARACTERS.test(name)) return "Use only letters (a–z), digits, _ and -.";
  const lower = name.toLowerCase();
  if (lower.startsWith("r_")) {
    return "Usernames starting with r_ are kept for people from other servers.";
  }
  if (lower.startsWith("deleted-")) {
    return "Usernames starting with deleted- are kept for deleted accounts.";
  }
  return null;
}

/**
 * The hint under the username field: the lowercase name the server saves, for a valid name with
 * capitals, otherwise the rules.
 */
export function usernameHint(value: string): string {
  const name = value.trim();
  if (usernameProblem(value) === null && name !== name.toLowerCase()) {
    return `Saved as ${name.toLowerCase()}.`;
  }
  return `${USERNAME_MIN} to ${USERNAME_MAX} characters: letters, digits, _ and -.`;
}
