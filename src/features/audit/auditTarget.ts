import type { AuditLogEntry } from "../../core/graphql/generated/schema-types";

/** Keys of `argsRedacted` that name the member an action was taken on, in order of preference. */
const TARGET_KEYS = ["user_id", "author_id"] as const;

/** The placeholder the server writes in place of a redacted argument. */
const REDACTED = "[REDACTED]";

/**
 * The user id an audit entry's action was taken on: the first string under `user_id` or
 * `author_id` in its arguments, or null when there is none, it is redacted, or it is the actor.
 */
export function auditTargetUserId(
  entry: Pick<AuditLogEntry, "actorUserId" | "argsRedacted">,
): string | null {
  const args: unknown = entry.argsRedacted;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  for (const key of TARGET_KEYS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value !== "string" || value === "" || value === REDACTED) continue;
    return value === entry.actorUserId ? null : value;
  }
  return null;
}

/** The first eight characters of `id` and an ellipsis: how the log names someone it cannot name. */
export function shortUserId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
