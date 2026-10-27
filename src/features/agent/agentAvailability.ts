import { detectPlatform, getRuntimeCapabilities } from "../../core/runtime/runtime";

/** What the agent's place shows in an app without the agent. */
export const AGENT_DESKTOP_ONLY_MESSAGE = "The AI agent is available in the desktop app.";

/** Commands that open the AI agent. */
const AGENT_COMMAND_IDS: ReadonlySet<string> = new Set(["workspace.open_agent"]);

/** Whether this app has the AI agent, which runs in the desktop app only. */
export function agentAvailable(): boolean {
  return getRuntimeCapabilities(detectPlatform()).agent;
}

/**
 * Whether a command is offered in this app: a command that opens the agent only where the
 * agent runs, every other command always.
 */
export function commandOfferedHere(commandId: string): boolean {
  return !AGENT_COMMAND_IDS.has(commandId) || agentAvailable();
}
