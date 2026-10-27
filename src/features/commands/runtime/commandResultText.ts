import { asSentence } from "../../../core/graphql/errors";
import type { CommandResult } from "../types";

/**
 * The success toast for a command run from the palette: its title, then the result's message
 * when it has one. The payload is data for scripts and the agent and is never shown.
 *
 * @returns For example "List Channels: 3 channels found." or "Open Settings".
 */
export function commandSuccessText(title: string, result: CommandResult): string {
  const message = result.message.trim();
  return message ? `${title}: ${asSentence(message)}` : title;
}
