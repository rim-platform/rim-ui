/**
 * Derive a confirmation verb from a command id, per Tony's resolution to
 * Scott §10 #1 (`confirm-command-modal-spec.md`). The backend does NOT yet
 * carry a `confirmation_verb` field; we own the derivation rule until a
 * future Phase ships it.
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
 * Verbs are normalized to lowercase for case-insensitive comparison in the
 * type-to-confirm input. Comparison is also trimmed.
 *
 * TODO(phase-6 i18n): displayed verb localizes; typed verb stays canonical
 * English; show "(create)" canonical hint in parens. Audit-log row records
 * the typed verb verbatim so it remains comparable across locales.
 */
const FALLBACK_VERB = "confirm";

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
