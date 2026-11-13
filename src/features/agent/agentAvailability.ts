import { detectPlatform, getRuntimeCapabilities } from "../../core/runtime/runtime";
import { generalCommandOfferedHere } from "../commands/runtime/appCommands/generalAvailability";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "../commands/runtime/appCommands/agentCommandIds";
import { desktopShellAvailable, QUIT_COMMAND_ID } from "../desktop-shell/availability";

/** What the agent's place shows in an app without the agent. */
export const AGENT_DESKTOP_ONLY_MESSAGE = "The assistant is available in the desktop app.";

/** Commands that open the assistant, or the settings of programs connected to RIM. */
const AGENT_COMMAND_IDS: ReadonlySet<string> = new Set([
  "workspace.open_agent",
  "workspace.open_agents",
  "agents.allow_in_encrypted_conversation",
  ...AGENT_MANAGEMENT_COMMAND_IDS,
]);

/** Whether this app has the assistant, which runs in the desktop app only. */
export function agentAvailable(): boolean {
  return getRuntimeCapabilities(detectPlatform()).agent;
}

/**
 * Whether a command is offered in this app: a command that opens the agent only where the
 * agent runs, quitting only in the desktop app, every other command always.
 */
export function commandOfferedHere(commandId: string): boolean {
  if (commandId === QUIT_COMMAND_ID) return desktopShellAvailable();
  if (!generalCommandOfferedHere(commandId)) return false;
  return !AGENT_COMMAND_IDS.has(commandId) || agentAvailable();
}
