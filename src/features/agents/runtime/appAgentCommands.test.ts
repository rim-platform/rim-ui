import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  fetchConversation: vi.fn(),
  fetchMyServers: vi.fn(),
  pinnedEncrypted: vi.fn(),
  showWindow: vi.fn(),
}));

vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request: mocks.request } }));
vi.mock("../../agent/tools/loader", () => ({
  EXECUTE_COMMAND_MUTATION: "the mutation",
  AI_COMMANDS_QUERY: "the query",
}));
vi.mock("../../conversations/api/useConversation", () => ({
  fetchConversation: mocks.fetchConversation,
  findCachedConversation: vi.fn(),
}));
vi.mock("../../conversations/api/useChannels", () => ({
  BROWSE_FILTER: {},
  fetchChannels: vi.fn(),
}));
vi.mock("../../e2ee/runtime/pins", () => ({ pinnedEncrypted: mocks.pinnedEncrypted }));
vi.mock("../../workspaces/api/useMyServers", () => ({ fetchMyServers: mocks.fetchMyServers }));
vi.mock("../../relay/state/useRelayStore", () => ({ isDirectSpace: () => false }));
vi.mock("../../plugins/chat/appMessageService", () => ({ appChatDeps: {} }));
vi.mock("../../updater/api/serverInfoApi", () => ({
  fetchServerInfo: () => Promise.resolve({ features: [], capabilities: ["command_run_id"] }),
}));
vi.mock("../../desktop-shell/api/desktopShell", () => ({ desktopShowWindow: mocks.showWindow }));

import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { appAgentCommands } from "./appAgentCommands";

const AGENT: ConnectedAgent = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: { w1: { all: true, channelIds: [] } },
  pluginApprovals: {},
  commandApprovals: ["chat.set_topic"],
};
const STORE = useConfirmationModalStore;

const SET_TOPIC = {
  id: "chat.set_topic",
  title: "Set Topic",
  description: "Set the channel's topic.",
  category: "Conversations",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  arguments: [
    {
      name: "conversation_id",
      title: "Conversation",
      description: "",
      argumentType: "CONVERSATION_ID",
      required: true,
    },
    { name: "topic", title: "Topic", description: "", argumentType: "STRING", required: true },
  ],
  requiredContext: [],
  dangerous: false,
  aiCallable: true,
  sensitivity: "MUTATING",
};

const HELD = {
  executeCommand: {
    status: "CONFIRMATION_REQUIRED",
    message: "",
    confirmationRequired: {
      token: "tok",
      argsHash: "hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  },
};
const DONE = { executeCommand: { status: "SUCCESS", message: "Topic set", payload: null } };

/** The mutations' inputs, in the order they were sent. */
function inputs() {
  return mocks.request.mock.calls
    .filter(([document]) => document === "the mutation")
    .map(([, variables]) => (variables as { input: Record<string, unknown> }).input);
}

describe("appAgentCommands", () => {
  beforeEach(() => {
    mocks.request
      .mockReset()
      .mockImplementation((document: string) =>
        document === "the query"
          ? Promise.resolve({ commands: [SET_TOPIC] })
          : Promise.resolve(DONE),
      );
    mocks.showWindow.mockReset().mockResolvedValue(null);
    mocks.fetchConversation.mockReset().mockResolvedValue({
      id: "c1",
      title: "general",
      conversationType: "CHANNEL",
      encryptedAt: null,
    });
    mocks.fetchMyServers.mockReset().mockResolvedValue([{ id: "w1", name: "Acme" }]);
    mocks.pinnedEncrypted.mockReset().mockResolvedValue(false);
    STORE.getState().reset();
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({ entries: [] });
  });

  afterEach(() => {
    STORE.getState().reset();
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
  });

  it("asks the person on the card, then runs it as the agent and re-sends with the proof", async () => {
    let mutations = 0;
    mocks.request.mockImplementation((document: string) => {
      if (document === "the query") return Promise.resolve({ commands: [SET_TOPIC] });
      mutations += 1;
      return Promise.resolve(mutations === 1 ? HELD : DONE);
    });
    const answer = appAgentCommands.runCommand(AGENT, {
      commandId: "chat.set_topic",
      workspaceId: "w1",
      arguments: { conversation_id: "c1", topic: "Release day" },
    });
    await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
    expect(mocks.request).toHaveBeenCalledWith("the query", {
      commandContext: { workspaceId: "w1" },
    });
    expect(STORE.getState().request).toMatchObject({
      initiator: "agent",
      commandId: "chat.set_topic",
      toolName: "Set Topic",
      description: "Set the channel's topic.",
      sensitivity: "MUTATING",
      args: {},
      outsideAgent: {
        name: "Claude Code",
        target: [
          { label: "Workspace", value: "Acme" },
          { label: "Channel", value: "general" },
          { label: "Command", value: "chat.set_topic" },
        ],
        args: { conversation_id: "c1", topic: "Release day" },
      },
    });
    expect(inputs()).toEqual([]);

    STORE.getState().approve();
    expect(await answer).toMatchObject({
      isError: false,
      payload: { outcome: "done", message: "Topic set" },
    });
    const first = {
      commandId: "chat.set_topic",
      args: { conversation_id: "c1", topic: "Release day" },
      commandContext: { workspaceId: "w1", conversationId: "c1" },
      initiator: CommandInitiator.AGENT,
      runId: expect.stringMatching(/^r_[A-Za-z0-9_-]{16}$/),
    };
    expect(inputs()).toEqual([
      first,
      { ...first, confirmation: { inBandToken: { token: "tok", argsHash: "hash" } } },
    ]);
    expect(useAgentRecordStore.getState().entries.map((entry) => entry.change)).toEqual([
      "asked",
      "done",
    ]);
  });

  it("runs nothing when the person discards the card", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT, { ...AGENT, id: "agent-discards" }] });
    const answer = appAgentCommands.runCommand(
      { ...AGENT, id: "agent-discards" },
      {
        commandId: "chat.set_topic",
        workspaceId: "w1",
        arguments: { conversation_id: "c1", topic: "x" },
      },
    );
    await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
    STORE.getState().reject();
    expect(await answer).toMatchObject({ payload: { outcome: "discarded" } });
    expect(inputs()).toEqual([]);
  });
});
