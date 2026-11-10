import {
  COMMAND_RELATIVE_MINUTES,
  serverHasCapability,
  spaceHasCapability,
} from "../../updater/api/serverCapabilities";

/** What a ban that would end after a set time is refused with, on a server that can't do it. */
export const RELATIVE_BAN_REFUSAL =
  "This server can't end a ban after a set time, so the ban wasn't sent. Choose a date and time instead.";

/** Whether a run of `commandId` with `args` bans someone for a number of minutes. */
function bansForMinutes(commandId: string, args: Record<string, unknown> | undefined): boolean {
  if (commandId !== "admin.ban" || !args) return false;
  const minutes = args.minutes;
  return minutes !== undefined && minutes !== null && minutes !== "";
}

/**
 * Why a run must not be sent: a ban with `minutes` to a server that does not list
 * `command_relative_minutes`, which would ignore the minutes and ban for good. A server whose list
 * cannot be read counts as one that does not list it.
 *
 * @param commandId - The command about to be sent.
 * @param args - Its arguments.
 * @param workspaceId - The workspace whose server it is sent to; the connected server's when
 *   left out.
 * @returns The refusal to show, or `null` when the run may be sent.
 */
export async function relativeBanRefusal(
  commandId: string,
  args: Record<string, unknown> | undefined,
  workspaceId: string | undefined,
): Promise<string | null> {
  if (!bansForMinutes(commandId, args)) return null;
  const listed = workspaceId
    ? await spaceHasCapability(workspaceId, COMMAND_RELATIVE_MINUTES)
    : await serverHasCapability(COMMAND_RELATIVE_MINUTES);
  return listed ? null : RELATIVE_BAN_REFUSAL;
}
