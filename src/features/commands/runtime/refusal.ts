import {
  graphqlErrorCode,
  graphqlErrorExtension,
  graphqlErrorMessage,
  asSentence,
} from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";

/** What kind of refusal a failed command call was. */
export type Refusal =
  | { kind: "DENIED"; missing: string | null }
  | { kind: "FAILED"; retrySafe: boolean }
  | { kind: "EXPIRED" }
  | { kind: "INVALID" };

const DENIED_CODES = new Set([
  "FORBIDDEN",
  "TIMED_OUT",
  "FEATURE_DISABLED",
  "CONVERSATION_ARCHIVED",
  "CONFIRMATION_FAILED",
]);
const FAILED_CODES = new Set(["TIMEOUT", "UNAVAILABLE", "INTERNAL", "UPSTREAM_UNAVAILABLE"]);
const INVALID_CODES = new Set(["VALIDATION", "NOT_FOUND", "CONFLICT"]);

/** The server's message when a workspace-only command is given the direct space's id. */
const NOT_IN_DIRECT_SPACE = "not available in the direct space";

/**
 * The refusal in a failed `executeCommand` or `executeMacro` call: from its `refusal` extension, or
 * from its `code` on a server that sends none. `null` when `err` is not a refusal the server gave.
 */
export function readRefusal(err: unknown): Refusal | null {
  const kind = graphqlErrorExtension(err, "refusal");
  const code = graphqlErrorCode(err);
  if (kind === "DENIED" || (kind === undefined && code && DENIED_CODES.has(code))) {
    const missing = graphqlErrorExtension(err, "missing");
    return { kind: "DENIED", missing: typeof missing === "string" ? missing : null };
  }
  if (
    kind === "FAILED" ||
    (kind === undefined && code && (FAILED_CODES.has(code) || code === "RATE_LIMITED"))
  ) {
    const retrySafe = graphqlErrorExtension(err, "retrySafe");
    return { kind: "FAILED", retrySafe: retrySafe === true || code === "RATE_LIMITED" };
  }
  if (kind === "EXPIRED" || (kind === undefined && code === "CONFIRMATION_STALE")) {
    return { kind: "EXPIRED" };
  }
  if (kind === "INVALID" || (kind === undefined && code && INVALID_CODES.has(code))) {
    return { kind: "INVALID" };
  }
  return null;
}

/**
 * Tells the person a command of theirs was refused, in the card that kind of refusal has. `retry`
 * runs the command again; it is offered only when that is known to be safe.
 */
export function showCommandRefusal(title: string, err: unknown, retry?: () => void): void {
  const refusal = readRefusal(err);
  const message = graphqlErrorMessage(err, "Command failed");
  switch (refusal?.kind) {
    case "DENIED":
      toast.error(`${title}: not done`, {
        card: "denied",
        description: refusal.missing
          ? `You don't have the \`${refusal.missing}\` permission.`
          : graphqlErrorMessage(err, "You don't have permission to do this."),
      });
      return;
    case "FAILED":
      toast.warning(`${title}: failed`, {
        card: "failed",
        description: refusal.retrySafe
          ? `${asSentence(message)} It is safe to try again.`
          : `${asSentence(message)} It may have gone through, so check before trying again.`,
        action: refusal.retrySafe && retry ? { label: "Retry", onClick: retry } : undefined,
      });
      return;
    case "EXPIRED":
      toast.info(`${title}: expired`, {
        card: "ended",
        description: "You didn't confirm in time. Nothing ran.",
        action: retry ? { label: "Ask again", onClick: retry } : undefined,
      });
      return;
    default:
      toast.error(`${title}: ${message}`);
  }
}

/** What the agent's model is told about a refused tool call, so it does not retry a decision. */
export function refusalForAgent(err: unknown): string | null {
  const refusal = readRefusal(err);
  if (!refusal) return null;
  const message = graphqlErrorMessage(err, "Command failed");
  switch (refusal.kind) {
    case "DENIED":
      return `Denied by policy, do not retry. Tell the user: ${message}`;
    case "FAILED":
      return refusal.retrySafe
        ? `Failed for a technical reason, safe to retry: ${message}`
        : `Failed for a technical reason. It may have run, so ask the user before retrying: ${message}`;
    case "EXPIRED":
      return "The confirmation expired and nothing ran. Ask the user before trying again.";
    case "INVALID":
      if (message === NOT_IN_DIRECT_SPACE) {
        return "That id is the person's direct messages, not a workspace, and it has no channels. Nothing ran. Use a workspace's id, or ask which workspace by name.";
      }
      return `The call is wrong, nothing ran: ${message}`;
  }
}
