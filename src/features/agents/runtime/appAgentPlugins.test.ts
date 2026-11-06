import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { PluginCommandInfo, PluginInfo } from "../../plugins/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  execute: vi.fn(),
  plugins: vi.fn(),
  showWindow: vi.fn(),
  focus: vi.fn(() => ({ selectedConversationId: "open", workspaceId: "open-workspace" })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../plugins/web/webPluginHost", () => ({
  webPluginHost: { execute: mocks.execute },
}));
vi.mock("../../plugins/api/usePluginList", () => ({ fetchPluginList: mocks.plugins }));
vi.mock("../../desktop-shell/api/desktopShell", () => ({ desktopShowWindow: mocks.showWindow }));
vi.mock("../../agent/tools/loader", () => ({ EXECUTE_COMMAND_MUTATION: "the mutation" }));
vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request: vi.fn() } }));
vi.mock("../../conversations/api/useConversation", () => ({
  fetchConversation: vi.fn(),
  findCachedConversation: vi.fn(),
}));
vi.mock("../../conversations/api/useChannels", () => ({
  BROWSE_FILTER: {},
  fetchChannels: vi.fn(),
}));
vi.mock("../../e2ee/runtime/pins", () => ({ pinnedEncrypted: vi.fn() }));
vi.mock("../../workspaces/api/useMyServers", () => ({ fetchMyServers: vi.fn() }));
vi.mock("../../relay/state/useRelayStore", () => ({ isDirectSpace: () => false }));
vi.mock("../../plugins/chat/appMessageService", () => ({ appChatDeps: {} }));

import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { agentCooldown } from "./appAgentChanges";
import { appAgentPlugins } from "./appAgentPlugins";

const PLUGIN = "dev.example.pods";
const HASH = "hash-1";
const STORE = useConfirmationModalStore;

function command(id: string, fields: Partial<PluginCommandInfo> = {}): PluginCommandInfo {
  return {
    id,
    qualified_id: `plugin.${PLUGIN}.${id}`,
    title: "List‮ pods",
    description: "Lists them",
    keybind_capable: false,
    dangerous: false,
    ai_callable: true,
    read_only: false,
    arguments: [],
    ...fields,
  };
}

function plugin(fields: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: PLUGIN,
    manifest_id: PLUGIN,
    display_name: "Pods",
    version: "1.0.0",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    manifest_hash: HASH,
    fingerprint_changed: false,
    runtime_kind: "DesktopLocalProcess",
    commands: [command("reads", { read_only: true }), command("changes")],
    ...fields,
  };
}

let nextAgent = 0;

/** A connected agent of its own: the cooldown is kept across tests. */
function connectedAgent(): ConnectedAgent {
  const agent: ConnectedAgent = {
    id: `agent-${(nextAgent += 1)}`,
    name: "Claude Code",
    tokenHash: "hash",
    pairedAt: "2026-11-06T10:00:00.000Z",
    grants: {},
    pluginApprovals: { [PLUGIN]: { manifestHash: HASH, commandIds: ["reads", "changes"] } },
  };
  useConnectedAgentsStore.setState({ agents: [agent] });
  return agent;
}

async function requestOpen() {
  await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
  return STORE.getState().request!;
}

describe("appAgentPlugins", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({ value: 1 });
    mocks.execute.mockReset().mockResolvedValue({ payload: { value: 2 } });
    mocks.plugins.mockReset().mockResolvedValue([plugin()]);
    mocks.showWindow.mockReset().mockResolvedValue(null);
    useAgentRecordStore.setState({ entries: [] });
    STORE.getState().reset();
  });

  afterEach(() => {
    STORE.getState().reset();
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
  });

  it("runs a local process's command in the host, with the approved hash", async () => {
    const answer = await appAgentPlugins.runCommand(connectedAgent(), {
      pluginId: PLUGIN,
      commandId: "reads",
      arguments: { a: 1 },
    });
    expect(answer.payload).toMatchObject({ outcome: "done", output: { value: 1 } });
    expect(mocks.invoke.mock.calls).toEqual([
      [
        "plugin_run_outside_agent_command",
        {
          pluginId: PLUGIN,
          commandId: "reads",
          approvedManifestHash: HASH,
          input: { a: 1 },
        },
      ],
    ]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("checks a web plugin's command in the host first, then runs it as an agent", async () => {
    mocks.plugins.mockResolvedValue([plugin({ runtime_kind: "WebSandboxed" })]);
    const answer = await appAgentPlugins.runCommand(connectedAgent(), {
      pluginId: PLUGIN,
      commandId: "reads",
      arguments: { a: 1 },
    });
    expect(answer.payload).toMatchObject({ outcome: "done", output: { value: 2 } });
    expect(mocks.invoke.mock.calls).toEqual([
      [
        "plugin_check_outside_agent_command",
        { pluginId: PLUGIN, commandId: "reads", approvedManifestHash: HASH },
      ],
    ]);
    expect(mocks.execute).toHaveBeenCalledWith({
      pluginId: PLUGIN,
      commandId: "reads",
      args: { a: 1 },
      initiator: "agent",
    });
  });

  it("does not run a web plugin's command when the host refuses it", async () => {
    mocks.plugins.mockResolvedValue([plugin({ runtime_kind: "WebSandboxed" })]);
    mocks.invoke.mockRejectedValueOnce({ kind: "LIFECYCLE_ERROR", message: "manifest changed" });
    const answer = await appAgentPlugins.runCommand(connectedAgent(), {
      pluginId: PLUGIN,
      commandId: "reads",
    });
    expect(answer.payload).toMatchObject({ refusal: "FAILED", retrySafe: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("shows the dialog with the plugin's words apart, and runs when confirmed", async () => {
    const answer = appAgentPlugins.runCommand(connectedAgent(), {
      pluginId: PLUGIN,
      commandId: "changes",
      arguments: { name: "x" },
    });
    const request = await requestOpen();
    expect(request).toMatchObject({
      initiator: "agent",
      toolName: "run a plugin command",
      args: {},
      sensitivity: CommandSensitivity.MUTATING,
      verb: null,
      outsideAgent: {
        name: "Claude Code",
        target: [
          { label: "Plugin", value: "Pods" },
          { label: "Command", value: "changes" },
        ],
        pluginWords: { title: "List‮ pods", description: "Lists them" },
        args: { name: "x" },
      },
    });
    expect(request.description).toBeUndefined();
    expect(request.outsideAgent?.text).toBeUndefined();
    expect(mocks.showWindow).toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();

    STORE.getState().approve();
    expect((await answer).payload).toMatchObject({ outcome: "done" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not run when the approval is revoked in the store during the dialog", async () => {
    const agent = connectedAgent();
    const answer = appAgentPlugins.runCommand(agent, { pluginId: PLUGIN, commandId: "changes" });
    await requestOpen();
    useConnectedAgentsStore.getState().setPluginApprovals(agent.id, PLUGIN, null);
    STORE.getState().approve();
    expect((await answer).payload).toMatchObject({ refusal: "DENIED" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("ends as expired when nobody answers, and holds the agent back", async () => {
    const agent = connectedAgent();
    vi.useFakeTimers();
    try {
      const answer = appAgentPlugins.runCommand(agent, { pluginId: PLUGIN, commandId: "changes" });
      await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await answer).payload).toMatchObject({ outcome: "expired" });
      expect(agentCooldown.active(agent.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers busy, recording nothing, while another confirmation is open", async () => {
    const agent = connectedAgent();
    void STORE.getState().open({
      commandId: "mine",
      toolName: "mine",
      args: {},
      token: "t",
      argsHash: "h",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const answer = await appAgentPlugins.runCommand(agent, {
      pluginId: PLUGIN,
      commandId: "changes",
    });
    expect(answer.payload).toMatchObject({ refusal: "FAILED", retrySafe: true });
    expect(useAgentRecordStore.getState().entries).toEqual([]);
    expect(STORE.getState().request?.commandId).toBe("mine");
  });

  it("does not offer anything the built-in agent was approved for", async () => {
    mocks.plugins.mockResolvedValue([plugin({ approved_ai_commands: ["reads", "changes"] })]);
    const agent = { ...connectedAgent(), pluginApprovals: {} };
    useConnectedAgentsStore.setState({ agents: [agent] });
    expect((await appAgentPlugins.listCommands(agent)).payload).toMatchObject({ commands: [] });
  });
});
