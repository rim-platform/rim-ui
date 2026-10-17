/** The verb used when a command id yields none. */
const FALLBACK_VERB = "confirm";

/**
 * Derive a confirmation verb from a command id. The backend carries no
 * confirmation verb, so the client derives it.
 *
 * Rule: split `command_id` on `.` and use the second segment's first word
 * (the verb part of `domain.verb_object`). Falls back to a generic verb if
 * the id has no `.` or the segment looks empty.
 *
 * Examples:
 *   chat.delete_message     → "delete"
 *   chat.create_channel     → "create"
 *   chat.pin_message        → "pin"
 *   workspace.uninstall_pl  → "uninstall"
 *   single_segment          → "confirm"  (fallback)
 *
 * @returns The verb in lowercase, for the case-insensitive, trimmed
 *   comparison in the type-to-confirm input.
 */
export function deriveConfirmationVerb(commandId: string): string {
  if (!commandId || typeof commandId !== "string") return FALLBACK_VERB;

  const parts = commandId.split(".");
  if (parts.length < 2) return FALLBACK_VERB;

  const second = parts[1] ?? "";
  // `verb_object` → first word; pure `verb` → entire segment.
  const verb = second.split("_")[0]?.trim().toLowerCase();
  if (!verb || verb.length === 0) return FALLBACK_VERB;
  return verb;
}

export function verbMatches(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}
