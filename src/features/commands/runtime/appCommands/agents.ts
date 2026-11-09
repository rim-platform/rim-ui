import { detectPlatform } from "../../../../core/runtime/runtime";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { toast } from "../../../../shared/toast";
import { AGENT_DESKTOP_ONLY_MESSAGE } from "../../../agent/agentAvailability";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../../../agent/state/confirmationModalStore";
import { useAgentApprovalWarningStore } from "../../../agents/state/useAgentApprovalWarningStore";
import { useAgentRecordStore } from "../../../agents/state/useAgentRecordStore";
import {
  useAgentsSettingsRequestStore,
  type AgentsSettingsRequest,
} from "../../../agents/state/useAgentsSettingsRequestStore";
import { useConnectedAgentsStore } from "../../../agents/state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../../../agents/state/usePendingPairingStore";
import type { TargetPickerKind } from "../../state/useCommandStore";
import type { CommandDefinition } from "../../types";
import type { LocalHandler } from "../commandDispatcher";
import {
  AGENT_ANSWER_COMMAND_IDS,
  APPROVE_AGENT_PAIRING,
  APPROVE_AGENT_REQUEST,
  REFUSE_AGENT_PAIRING,
  REFUSE_AGENT_REQUEST,
} from "./agentCommandIds";
import { localCommand } from "./localCommand";

const NO_REQUEST = "No agent is waiting for an answer";
const NO_PAIRING = "No agent is waiting to connect";

/** The agent request open in the confirmation dialog, if one is: never the person's own command. */
function openAgentRequest(): ConfirmationRequest | null {
  const { request } = useConfirmationModalStore.getState();
  return request && request.initiator !== "user" ? request : null;
}

/** Whether this app has agents; when it does not, says so. */
function onDesktop(): boolean {
  if (detectPlatform() === "desktop") return true;
  toast.info(AGENT_DESKTOP_ONLY_MESSAGE);
  return false;
}

/**
 * Whether a keybind to `commandId` runs while a host dialog is open: one of the commands that
 * answer an agent, while an agent's request or connection is waiting and no approval warning is
 * open yet. Every other keybind waits for the dialog to close.
 */
export function keybindAnswersWaitingAgent(commandId: string): boolean {
  if (!AGENT_ANSWER_COMMAND_IDS.includes(commandId)) return false;
  if (useAgentApprovalWarningStore.getState().warning !== null) return false;
  return openAgentRequest() !== null || usePendingPairingStore.getState().pending !== null;
}

/** Opens Settings > Agents on what `request` asks for. */
function openInAgentsSettings(request: AgentsSettingsRequest): void {
  useAgentsSettingsRequestStore.getState().open(request);
  useShellStore.getState().setMainSurface({ kind: "settings", tab: "agents" });
}

/** A command that opens one connected agent's dialog in Settings > Agents, picked in the palette. */
function forPickedAgent(kind: "disconnect" | "chooseReads" | "choosePlugins"): LocalHandler {
  return (args) => {
    if (!onDesktop()) return;
    const picked = args?.agentId ?? args?.agent_id;
    const agentId = typeof picked === "string" ? picked : undefined;
    const known = useConnectedAgentsStore.getState().agents.some((agent) => agent.id === agentId);
    if (!agentId || !known) {
      toast.info("That agent is no longer connected");
      return;
    }
    openInAgentsSettings({ kind, agentId });
  };
}

export const AGENT_COMMANDS: CommandDefinition[] = [
  localCommand(
    APPROVE_AGENT_REQUEST,
    "Agents",
    "Approve the Agent's Request…",
    "Approve what the waiting agent asked for, after a warning",
  ),
  localCommand(
    REFUSE_AGENT_REQUEST,
    "Agents",
    "Refuse the Agent's Request",
    "Turn down what the waiting agent asked for",
  ),
  localCommand(
    APPROVE_AGENT_PAIRING,
    "Agents",
    "Connect the Waiting Agent…",
    "Connect the program asking to, after a warning",
  ),
  localCommand(
    REFUSE_AGENT_PAIRING,
    "Agents",
    "Don't Connect the Waiting Agent",
    "Turn down the program asking to connect",
  ),
  localCommand(
    "agents.disconnect",
    "Agents",
    "Disconnect Agent…",
    "Choose a connected agent and disconnect it",
  ),
  localCommand(
    "agents.choose_reads",
    "Agents",
    "Choose What an Agent Can Read…",
    "Choose the workspaces and channels a connected agent can read",
  ),
  localCommand(
    "agents.choose_plugin_commands",
    "Agents",
    "Choose an Agent's Commands…",
    "Choose the RIM and plugin commands a connected agent can ask to run",
  ),
  localCommand("agents.open_runs", "Agents", "Open Agent Runs", "See every run of your agents"),
  localCommand(
    "agents.open_record",
    "Agents",
    "What Agents Were Given",
    "See what RIM handed to agents and what they asked to do",
  ),
  localCommand(
    "agents.clear_record",
    "Agents",
    "Clear the Agents Record…",
    "Clear the record of what agents were given, after a confirmation",
  ),
];

export const AGENT_HANDLERS: Record<string, LocalHandler> = {
  // Only opens the warning: approving is its Approve button, never this command.
  [APPROVE_AGENT_REQUEST]: () => {
    if (!onDesktop()) return;
    if (useAgentApprovalWarningStore.getState().warning !== null) return;
    const request = openAgentRequest();
    if (!request) {
      toast.info(NO_REQUEST);
      return;
    }
    useAgentApprovalWarningStore.getState().show({ kind: "request", token: request.token });
  },
  [REFUSE_AGENT_REQUEST]: () => {
    if (!onDesktop()) return;
    if (!openAgentRequest()) {
      toast.info(NO_REQUEST);
      return;
    }
    useAgentApprovalWarningStore.getState().close();
    useConfirmationModalStore.getState().reject();
  },
  // Only opens the warning: connecting is its Connect button, never this command.
  [APPROVE_AGENT_PAIRING]: () => {
    if (!onDesktop()) return;
    if (useAgentApprovalWarningStore.getState().warning !== null) return;
    const { pending } = usePendingPairingStore.getState();
    if (!pending) {
      toast.info(NO_PAIRING);
      return;
    }
    useAgentApprovalWarningStore.getState().show({ kind: "pairing", requestId: pending.requestId });
  },
  [REFUSE_AGENT_PAIRING]: () => {
    if (!onDesktop()) return;
    const { pending, refuse } = usePendingPairingStore.getState();
    if (!pending) {
      toast.info(NO_PAIRING);
      return;
    }
    useAgentApprovalWarningStore.getState().close();
    refuse(pending.requestId);
  },
  "agents.disconnect": forPickedAgent("disconnect"),
  "agents.choose_reads": forPickedAgent("chooseReads"),
  "agents.choose_plugin_commands": forPickedAgent("choosePlugins"),
  "agents.open_runs": () => {
    if (onDesktop()) openInAgentsSettings({ kind: "allRuns" });
  },
  "agents.open_record": () => {
    if (onDesktop()) openInAgentsSettings({ kind: "record" });
  },
  "agents.clear_record": () => {
    if (!onDesktop()) return;
    if (useAgentRecordStore.getState().entries.length === 0) {
      toast.info("The agents record is already empty");
      return;
    }
    openInAgentsSettings({ kind: "clearRecord" });
  },
};

/** The agent commands that ask for a connected agent in the palette before they run. */
export const AGENT_ARGUMENT_PROMPTS: Record<
  string,
  { argument: string; alias: string; picker: TargetPickerKind }
> = {
  "agents.disconnect": { argument: "agent_id", alias: "agentId", picker: "agent" },
  "agents.choose_reads": { argument: "agent_id", alias: "agentId", picker: "agent" },
  "agents.choose_plugin_commands": { argument: "agent_id", alias: "agentId", picker: "agent" },
};
