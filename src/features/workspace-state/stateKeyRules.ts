/** The longest key workspace state takes. */
export const MAX_STATE_KEY_LENGTH = 512;

/** The namespace the server keeps for its own services: no person writes a key in it. */
export const SYSTEM_KEY_PREFIX = "system.";

/**
 * Why `key` breaks the rules workspace state keys follow, in plain words, or `null` when it
 * keeps them: 2 to 512 characters, a lowercase letter first, then lowercase letters, digits and
 * `. _ : -`, a letter or a digit last, and, unless `allowSystem` is set, not under `system.`.
 *
 * @param key - The key as typed.
 * @param options - `allowSystem` for a read, which may name a key the server keeps.
 * @returns The rule the key breaks, or `null`.
 */
export function stateKeyProblem(
  key: string,
  options: { allowSystem?: boolean } = {},
): string | null {
  if (key.length < 2) return "A key has at least 2 characters";
  if (key.length > MAX_STATE_KEY_LENGTH) {
    return `A key has at most ${MAX_STATE_KEY_LENGTH} characters`;
  }
  if (!/^[a-z]/.test(key)) return "A key starts with a lowercase letter";
  if (/[^a-z0-9_.:-]/.test(key)) {
    return "A key has only lowercase letters, digits and . _ : -";
  }
  if (!/[a-z0-9]$/.test(key)) return "A key ends with a lowercase letter or a digit";
  if (!options.allowSystem && key.startsWith(SYSTEM_KEY_PREFIX)) {
    return "Keys starting with system. are kept for the workspace itself";
  }
  return null;
}
