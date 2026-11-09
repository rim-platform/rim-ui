import { CommandSensitivity } from "../../../../core/graphql/generated/schema-types";
import type { ConfirmationRequest } from "../../state/confirmationModalStore";
import { deriveConfirmationVerb } from "./verbDeriver";

/** How long Confirm stays disabled when a program outside RIM asked for the dialog. */
export const OUTSIDE_AGENT_ARM_MS = 1_000;

/**
 * The sensitivity the confirmation dialog treats `request` as. The server holds a user's command
 * only when it is dangerous or stricter, so a user's request without one counts as `MUTATING`.
 */
export function shownSensitivity(request: ConfirmationRequest): CommandSensitivity | undefined {
  return (
    request.sensitivity ?? (request.initiator === "user" ? CommandSensitivity.MUTATING : undefined)
  );
}

/**
 * The word the person types before `request` can be confirmed: for a `RESTRICTED` command, and
 * for a `MUTATING` one the agent proposed after reading a tool result in the same run.
 *
 * @returns The word, or `null` when none is asked for.
 */
export function typedWordFor(request: ConfirmationRequest): string | null {
  if (request.verb === null) return null;
  const sensitivity = shownSensitivity(request);
  const required =
    sensitivity === CommandSensitivity.RESTRICTED ||
    (!!request.sameTurnAfterToolResult && sensitivity === CommandSensitivity.MUTATING);
  return required ? (request.verb ?? deriveConfirmationVerb(request.commandId)) : null;
}
