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
  CONNECT_AGENT,
  REFUSE_AGENT_PAIRING,
  REFUSE_AGENT_REQUEST,
} from "./agentCommandIds";
import { localCommand } from "./localCommand";

const NO_REQUEST = "No agent is waiting for an answer";
const NO_PAIRING = "No agent is waiting to connect";
/** What connecting an agent says in an app without agents. */
export const CONNECT_DESKTOP_ONLY_MESSAGE = "Connecting agents needs the desktop app";

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

/** The `agent_id` (or `agentId`) argument, when one is given. */
function agentIdArg(args: Record<string, unknown> | undefined): string | undefined {
  const picked = args?.agentId ?? args?.agent_id;
  return typeof picked === "string" && picked !== "" ? picked : undefined;
}

/** Whether `agentId` names a connected agent; when it does not, says so. */
function stillConnected(agentId: string | undefined): agentId is string {
  const known = useConnectedAgentsStore.getState().agents.some((agent) => agent.id === agentId);
  if (!agentId || !known) toast.info("That agent is no longer connected");
  return Boolean(agentId) && known;
}

/** A command that opens one connected agent's dialog in Settings > Agents, picked in the palette. */
function forPickedAgent(kind: "disconnect" | "chooseReads" | "choosePlugins"): LocalHandler {
  return (args) => {
    if (!onDesktop()) return;
    const agentId = agentIdArg(args);
    if (stillConnected(agentId)) openInAgentsSettings({ kind, agentId });
  };
}

/**
 * A command that opens what every agent did in Settings > Agents, or only what the connected
 * agent its `agent_id` argument names did.
 */
function forEveryOrOneAgent(every: AgentsSettingsRequest, one: "runs" | "record"): LocalHandler {
  return (args) => {
    if (!onDesktop()) return;
    const agentId = agentIdArg(args);
    if (agentId === undefined) openInAgentsSettings(every);
    else if (stillConnected(agentId)) openInAgentsSettings({ kind: one, agentId });
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
  localCommand(
    CONNECT_AGENT,
    "Agents",
    "Connect an Agent…",
    "Connect a program on this computer and get its token and setup, shown once",
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
  "agents.open_runs": forEveryOrOneAgent({ kind: "allRuns" }, "runs"),
  "agents.open_record": forEveryOrOneAgent({ kind: "record" }, "record"),
  "agents.clear_record": () => {
    if (!onDesktop()) return;
    if (useAgentRecordStore.getState().entries.length === 0) {
      toast.info("The agents record is already empty");
      return;
    }
    openInAgentsSettings({ kind: "clearRecord" });
  },
  [CONNECT_AGENT]: () => {
    if (detectPlatform() !== "desktop") {
      toast.info(CONNECT_DESKTOP_ONLY_MESSAGE);
      return;
    }
    openInAgentsSettings({ kind: "connect" });
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
