import { runCommandFromClick } from "../commands/runtime/runFromClick";
import type { CommandResult } from "../commands/types";

/**
 * Runs the moderation command `commandId` in `workspaceId` once a moderation dialog was the
 * person's confirmation: no confirmation is asked again unless the command is Restricted, no
 * outcome toast is shown (the dialog says what happened), and a failure is thrown for the dialog
 * to show.
 *
 * @param args - The command's arguments besides `server_id`.
 * @returns The command's result, or `null` when the person cancelled a confirmation the command
 *   still asked for.
 * @throws An `Error` with the server's message when the command failed.
 */
export async function runConfirmedModeration(
  workspaceId: string,
  commandId: string,
  args: Record<string, unknown>,
): Promise<CommandResult | null> {
  const outcome = await runCommandFromClick(
    commandId,
    { server_id: workspaceId, ...args },
    { confirmed: true, throwOnError: true, successToast: null, target: { workspaceId } },
  );
  return outcome.ok ? outcome.result : null;
}

/** The field `key` of a command result's payload, when the payload is an object that has it. */
export function payloadField(result: CommandResult, key: string): unknown {
  const payload = result.payload;
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** Whole minutes from `now` until `until`, rounded up and at least 1, as `admin.timeout` takes. */
export function minutesUntil(until: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000));
}
