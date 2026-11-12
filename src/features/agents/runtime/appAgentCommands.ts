/** The agent's RIM commands wired to the app: its server, its confirmation dialog and its record. */

import { isDirectSpace } from "../../relay/state/useRelayStore";
import { fetchAgentCommands } from "../api/agentCommandList";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { createAgentCommands, type AgentCommandConfirmation } from "./agentCommands";
import {
  agentCooldown,
  askPerson,
  channelName,
  commandsOff,
  confirmationOpen,
  executeAsAgent,
} from "./appAgentChanges";
import { lookup, record, runId, workspaces } from "./appAgentReads";

function confirm(request: AgentCommandConfirmation): Promise<"approved" | "discarded" | "busy"> {
  return askPerson({
    initiator: "agent",
    commandId: request.commandId,
    toolName: request.title,
    args: {},
    sensitivity: request.sensitivity,
    description: request.description,
    token: request.token,
    argsHash: "",
    expiresAt: request.expiresAt,
    outsideAgent: {
      name: request.agentName,
      target: [
        { label: "Workspace", value: request.workspaceName },
        ...(request.channelName === null ? [] : [{ label: "Channel", value: request.channelName }]),
        { label: "Command", value: request.commandId },
      ],
      args: request.args,
    },
  });
}

/** The agent as the store holds it now. */
function current(agentId: string) {
  return useConnectedAgentsStore.getState().agents.find(({ id }) => id === agentId) ?? null;
}

/** The RIM commands this app answers agents with. */
export const appAgentCommands = createAgentCommands({
  commands: fetchAgentCommands,
  workspaces,
  isDirectSpace,
  lookup,
  channelName,
  current,
  commandsOff,
  runId,
  execute: executeAsAgent,
  busy: confirmationOpen,
  confirm,
  record,
  cooldown: agentCooldown,
  now: () => Date.now(),
});
