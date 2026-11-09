import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/runtime/runtime")>()),
  detectPlatform: vi.fn(() => "desktop"),
}));

import { detectPlatform } from "../../../../core/runtime/runtime";
import { toast } from "../../../../shared/toast";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { AGENT_DESKTOP_ONLY_MESSAGE, commandOfferedHere } from "../../../agent/agentAvailability";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../../../agent/state/confirmationModalStore";
import { commandsToBackendTools } from "../../../agent/tools/loader";
import { makeCommand } from "../../../agent/tools/test-helpers";
import { useAgentApprovalWarningStore } from "../../../agents/state/useAgentApprovalWarningStore";
import { useAgentRecordStore } from "../../../agents/state/useAgentRecordStore";
import { useAgentsSettingsRequestStore } from "../../../agents/state/useAgentsSettingsRequestStore";
import { useConnectedAgentsStore } from "../../../agents/state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../../../agents/state/usePendingPairingStore";
import { CommandExecutionTarget } from "../../../../core/graphql/generated/schema-types";
import { useCommandStore } from "../../state/useCommandStore";
import { dispatchCommand, hasLocalHandler, runDesktopLocalCommand } from "../commandDispatcher";
import { LOCAL_COMMANDS } from "../localCommands";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "./agentCommandIds";
import { AGENT_COMMANDS, keybindAnswersWaitingAgent } from "./agents";

const IDS = [
  "agents.approve_request",
  "agents.refuse_request",
  "agents.approve_pairing",
  "agents.refuse_pairing",
  "agents.disconnect",
  "agents.choose_reads",
  "agents.choose_plugin_commands",
  "agents.open_runs",
  "agents.open_record",
  "agents.clear_record",
];

const executeBackend = vi.fn();

function run(id: string, args?: Record<string, unknown>) {
  const command = LOCAL_COMMANDS.find((c) => c.id === id)!;
  return dispatchCommand(command, executeBackend, { args, commandContext: {} });
}

function agentRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    initiator: "agent",
    commandId: "chat.post_message",
    toolName: "send a message",
    args: {},
    token: "token-1",
    argsHash: "hash-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    outsideAgent: { name: "Claude Code", target: [{ label: "Channel", value: "general" }] },
    ...overrides,
  };
}

const AGENT = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: {},
  pluginApprovals: {},
};

describe("agent commands", () => {
  const approvePairing = vi.fn();
  const refusePairing = vi.fn();

  beforeEach(() => {
    vi.mocked(detectPlatform).mockReturnValue("desktop");
    usePendingPairingStore.setState({
      pending: null,
      approve: approvePairing,
      refuse: refusePairing,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useConfirmationModalStore.getState().reset();
    useAgentApprovalWarningStore.setState({ warning: null });
    useAgentsSettingsRequestStore.setState({ request: null });
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
    usePendingPairingStore.setState(usePendingPairingStore.getInitialState(), true);
    useCommandStore.getState().closeCommandPalette();
    useShellStore.getState().reset();
  });

  it("defines each command in Agents, run on this device, keybindable, with a handler", () => {
    expect(AGENT_COMMANDS.map((c) => c.id)).toEqual(IDS);
    expect([...AGENT_MANAGEMENT_COMMAND_IDS].sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const command = LOCAL_COMMANDS.find((c) => c.id === id);
      expect(command, id).toBeDefined();
      expect(command!.category, id).toBe("Agents");
      expect(command!.executionTarget, id).toBe("DESKTOP_LOCAL");
      expect(command!.keybindCapable, id).toBe(true);
      expect(hasLocalHandler(id), id).toBe(true);
    }
  });

  it("offers them only in the desktop app", () => {
    for (const id of IDS) expect(commandOfferedHere(id), id).toBe(true);
    vi.mocked(detectPlatform).mockReturnValue("web");
    for (const id of IDS) expect(commandOfferedHere(id), id).toBe(false);
  });

  it("says the agent is desktop only when run elsewhere", async () => {
    vi.mocked(detectPlatform).mockReturnValue("web");
    void useConfirmationModalStore.getState().open(agentRequest());
    await run("agents.approve_request");
    expect(toast.info).toHaveBeenCalledWith(AGENT_DESKTOP_ONLY_MESSAGE);
    expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
  });

  describe("approve_request", () => {
    it("says so when no agent is waiting", async () => {
      await run("agents.approve_request");
      expect(toast.info).toHaveBeenCalledWith("No agent is waiting for an answer");
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
    });

    it("leaves the person's own command confirmation alone", async () => {
      void useConfirmationModalStore.getState().open(agentRequest({ initiator: "user" }));
      await run("agents.approve_request");
      expect(toast.info).toHaveBeenCalledWith("No agent is waiting for an answer");
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
    });

    it("opens the warning and approves nothing itself", async () => {
      const decision = vi.fn();
      void useConfirmationModalStore.getState().open(agentRequest()).then(decision);
      await run("agents.approve_request");
      expect(useAgentApprovalWarningStore.getState().warning).toEqual({
        kind: "request",
        token: "token-1",
      });
      await Promise.resolve();
      expect(decision).not.toHaveBeenCalled();
      expect(useConfirmationModalStore.getState().request?.token).toBe("token-1");
    });
  });

  describe("refuse_request", () => {
    it("refuses the open request at once", async () => {
      const decision = useConfirmationModalStore.getState().open(agentRequest());
      await run("agents.refuse_request");
      await expect(decision).resolves.toEqual({ approved: false });
      expect(useConfirmationModalStore.getState().request).toBeNull();
    });

    it("says so when no agent is waiting", async () => {
      await run("agents.refuse_request");
      expect(toast.info).toHaveBeenCalledWith("No agent is waiting for an answer");
    });
  });

  describe("pairing", () => {
    const PENDING = {
      requestId: "pair-1",
      name: "Claude Code",
      code: "123456",
      expiresAt: Date.now() + 60_000,
    };

    it("opens the warning to connect and connects nothing itself", async () => {
      usePendingPairingStore.setState({ pending: PENDING });
      await run("agents.approve_pairing");
      expect(useAgentApprovalWarningStore.getState().warning).toEqual({
        kind: "pairing",
        requestId: "pair-1",
      });
      expect(approvePairing).not.toHaveBeenCalled();
    });

    it("refuses at once", async () => {
      usePendingPairingStore.setState({ pending: PENDING });
      await run("agents.refuse_pairing");
      expect(refusePairing).toHaveBeenCalledWith("pair-1");
    });

    it("says so when no agent is waiting to connect", async () => {
      await run("agents.approve_pairing");
      await run("agents.refuse_pairing");
      expect(toast.info).toHaveBeenNthCalledWith(1, "No agent is waiting to connect");
      expect(toast.info).toHaveBeenNthCalledWith(2, "No agent is waiting to connect");
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
      expect(refusePairing).not.toHaveBeenCalled();
    });
  });

  describe("keybinds while a dialog is open", () => {
    it("let only the answering commands through while an agent waits", () => {
      expect(keybindAnswersWaitingAgent("agents.approve_request")).toBe(false);
      void useConfirmationModalStore.getState().open(agentRequest());
      for (const id of IDS.slice(0, 4)) expect(keybindAnswersWaitingAgent(id), id).toBe(true);
      expect(keybindAnswersWaitingAgent("agents.disconnect")).toBe(false);
      expect(keybindAnswersWaitingAgent("workspace.open_search")).toBe(false);
    });

    it("let nothing through once the warning is open", () => {
      void useConfirmationModalStore.getState().open(agentRequest());
      useAgentApprovalWarningStore.getState().show({ kind: "request", token: "token-1" });
      expect(keybindAnswersWaitingAgent("agents.approve_request")).toBe(false);
      expect(keybindAnswersWaitingAgent("agents.refuse_request")).toBe(false);
    });
  });

  describe("managing agents", () => {
    it("asks which agent first, in the palette", async () => {
      await run("agents.disconnect");
      expect(useCommandStore.getState().targetPicker).toEqual({
        commandId: "agents.disconnect",
        kind: "agent",
      });
      expect(useAgentsSettingsRequestStore.getState().request).toBeNull();
    });

    it("opens the disconnect confirmation of the agent picked", async () => {
      useConnectedAgentsStore.setState({ agents: [AGENT] });
      await run("agents.disconnect", { agentId: "agent-1" });
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({
        kind: "disconnect",
        agentId: "agent-1",
      });
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
      expect(useConnectedAgentsStore.getState().agents).toEqual([AGENT]);
    });

    it("opens what an agent can read and its plugin commands", async () => {
      useConnectedAgentsStore.setState({ agents: [AGENT] });
      await run("agents.choose_reads", { agentId: "agent-1" });
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({
        kind: "chooseReads",
        agentId: "agent-1",
      });
      await run("agents.choose_plugin_commands", { agentId: "agent-1" });
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({
        kind: "choosePlugins",
        agentId: "agent-1",
      });
    });

    it("says so when the agent picked is gone", async () => {
      await run("agents.choose_reads", { agentId: "gone" });
      expect(toast.info).toHaveBeenCalledWith("That agent is no longer connected");
      expect(useAgentsSettingsRequestStore.getState().request).toBeNull();
    });

    it("opens every run and the record", async () => {
      await run("agents.open_runs");
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({ kind: "allRuns" });
      await run("agents.open_record");
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({ kind: "record" });
    });

    it("opens one connected agent's runs and record when its agent_id is given", async () => {
      useConnectedAgentsStore.setState({ agents: [AGENT] });
      await run("agents.open_runs", { agent_id: "agent-1" });
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({
        kind: "runs",
        agentId: "agent-1",
      });
      await run("agents.open_record", { agent_id: "agent-1" });
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({
        kind: "record",
        agentId: "agent-1",
      });
    });

    it("opens no runs or record of an agent that is gone", async () => {
      await run("agents.open_runs", { agent_id: "gone" });
      await run("agents.open_record", { agent_id: "gone" });
      expect(toast.info).toHaveBeenCalledWith("That agent is no longer connected");
      expect(useAgentsSettingsRequestStore.getState().request).toBeNull();
    });

    it("opens the clear confirmation, never clearing itself", async () => {
      const entry = {
        at: "2026-11-06T10:00:00.000Z",
        agentId: "agent-1",
        agentName: "Claude Code",
        tool: "rim_read_messages",
        workspaceId: "w1",
        channelId: "c1",
        query: false,
        messageIds: ["m1"],
        refused: false,
      };
      useAgentRecordStore.setState({ entries: [entry] });
      await run("agents.clear_record");
      expect(useAgentsSettingsRequestStore.getState().request).toEqual({ kind: "clearRecord" });
      expect(useAgentRecordStore.getState().entries).toEqual([entry]);
    });

    it("says so when the record is already empty", async () => {
      await run("agents.clear_record");
      expect(toast.info).toHaveBeenCalledWith("The agents record is already empty");
      expect(useAgentsSettingsRequestStore.getState().request).toBeNull();
    });
  });

  describe("never an agent's", () => {
    it("are not run for the in-app agent", () => {
      void useConfirmationModalStore.getState().open(agentRequest());
      for (const id of IDS) expect(runDesktopLocalCommand(id), id).toBe(false);
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
      expect(useConfirmationModalStore.getState().request?.token).toBe("token-1");
    });

    it("are left out of the in-app agent's tools even when the server lists them", () => {
      const listed = IDS.map((id) =>
        makeCommand({ id, executionTarget: CommandExecutionTarget.DESKTOP_LOCAL }),
      );
      const tools = commandsToBackendTools([...listed, makeCommand({ id: "chat.send_message" })]);
      expect(tools.map((tool) => tool.definition.name)).toEqual(["chat.send_message"]);
    });
  });
});
