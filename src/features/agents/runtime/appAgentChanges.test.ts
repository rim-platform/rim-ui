import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  fetchConversation: vi.fn(),
  fetchMyServers: vi.fn(),
  pinnedEncrypted: vi.fn(),
  showWindow: vi.fn(),
  direct: new Set<string>(),
}));

vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request: mocks.request } }));
vi.mock("../../agent/tools/loader", () => ({ EXECUTE_COMMAND_MUTATION: "the mutation" }));
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
vi.mock("../../relay/state/useRelayStore", () => ({
  isDirectSpace: (id: string) => mocks.direct.has(id),
}));
vi.mock("../../plugins/chat/appMessageService", () => ({ appChatDeps: {} }));
vi.mock("../../desktop-shell/api/desktopShell", () => ({ desktopShowWindow: mocks.showWindow }));

import { logger } from "../../../core/logger";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { appAgentChanges } from "./appAgentChanges";

const AGENT: ConnectedAgent = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: { w1: { all: true, channelIds: [] } },
};
const ARGS = { workspaceId: "w1", channelId: "c1", text: "hello" };
const STORE = useConfirmationModalStore;

/** A connected agent of its own: the changes keep each agent's cooldown across tests. */
function freshAgent(id: string): ConnectedAgent {
  const agent = { ...AGENT, id };
  useConnectedAgentsStore.setState({ agents: [agent] });
  return agent;
}

function challenge(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {
    executeCommand: {
      status: "CONFIRMATION_REQUIRED",
      message: "",
      confirmationRequired: { token: "tok", argsHash: "hash", expiresAt },
    },
  };
}

const POSTED = {
  executeCommand: { status: "SUCCESS", message: "", payload: { message_id: "m1" } },
};

function inputs() {
  return mocks.request.mock.calls.map(([, variables]) => (variables as { input: object }).input);
}

/** Waits until the dialog's request is open. */
async function requestOpen() {
  await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
  return STORE.getState().request!;
}

describe("appAgentChanges", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.showWindow.mockReset().mockResolvedValue(null);
    mocks.fetchConversation.mockReset().mockResolvedValue({
      id: "c1",
      title: "general",
      conversationType: "CHANNEL",
      encryptedAt: null,
    });
    mocks.fetchMyServers.mockReset().mockResolvedValue([{ id: "w1", name: "Acme" }]);
    mocks.pinnedEncrypted.mockReset().mockResolvedValue(false);
    mocks.direct.clear();
    STORE.getState().reset();
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({ entries: [] });
  });

  afterEach(() => {
    STORE.getState().reset();
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks the server as an agent, with the ids in the args and no context", async () => {
    mocks.request.mockResolvedValueOnce(POSTED);
    await appAgentChanges.sendMessage(AGENT, ARGS);
    expect(inputs()).toEqual([
      {
        commandId: "chat.post_message",
        args: { server_id: "w1", conversation_id: "c1", text: "hello" },
        initiator: CommandInitiator.AGENT,
      },
    ]);
    expect(mocks.request.mock.calls[0][0]).toBe("the mutation");
  });

  it("shows the dialog, and sends with the proof when the person confirms", async () => {
    mocks.request.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(POSTED);
    const answer = appAgentChanges.sendMessage(AGENT, ARGS);
    const request = await requestOpen();
    expect(request).toMatchObject({
      initiator: "agent",
      commandId: "chat.post_message",
      toolName: "send a message",
      args: {},
      verb: null,
      token: "tok",
      argsHash: "hash",
      outsideAgent: {
        name: "Claude Code",
        target: [
          { label: "Workspace", value: "Acme" },
          { label: "Channel", value: "general" },
        ],
        text: "hello",
      },
    });
    expect(mocks.showWindow).toHaveBeenCalledOnce();

    STORE.getState().approve();
    expect(await answer).toMatchObject({ isError: false, payload: { messageId: "m1" } });
    expect(inputs()[1]).toEqual({
      commandId: "chat.post_message",
      args: { server_id: "w1", conversation_id: "c1", text: "hello" },
      initiator: CommandInitiator.AGENT,
      confirmation: { inBandToken: { token: "tok", argsHash: "hash" } },
    });
    expect(useAgentRecordStore.getState().entries.map((entry) => entry.change)).toEqual([
      "asked",
      "sent",
    ]);
  });

  it("uses the channel's id in the dialog when it has no title", async () => {
    mocks.fetchConversation.mockResolvedValue({
      id: "c1",
      conversationType: "CHANNEL",
      encryptedAt: null,
    });
    mocks.request.mockResolvedValueOnce(challenge());
    const answer = appAgentChanges.sendMessage(freshAgent("no-title"), ARGS);
    expect((await requestOpen()).outsideAgent?.target[1].value).toBe("c1");
    STORE.getState().reject();
    await answer;
  });

  it("answers busy without touching what is open, and without bringing the window forward", async () => {
    const own = STORE.getState().open({
      commandId: "x",
      toolName: "x",
      args: {},
      token: "own",
      argsHash: "h",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    mocks.request.mockResolvedValueOnce(challenge());
    const outcome = await appAgentChanges.sendMessage(AGENT, ARGS);
    expect(outcome.payload).toMatchObject({ refusal: "FAILED", retrySafe: true });
    expect(STORE.getState().request?.token).toBe("own");
    expect(mocks.showWindow).not.toHaveBeenCalled();
    STORE.getState().approve();
    await expect(own).resolves.toEqual({ approved: true });
  });

  it("goes on when the window cannot be brought forward", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mocks.showWindow.mockRejectedValue(new Error("no window"));
    mocks.request.mockResolvedValueOnce(challenge());
    const answer = appAgentChanges.sendMessage(freshAgent("no-window"), ARGS);
    await requestOpen();
    STORE.getState().reject();
    expect(await answer).toMatchObject({ payload: { outcome: "discarded" } });
  });

  it("ends the request at its expiry with no dialog on screen", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mocks.request.mockResolvedValueOnce(challenge());
    const answer = appAgentChanges.sendMessage(freshAgent("no-dialog"), ARGS);
    await vi.waitFor(() => expect(STORE.getState().request).not.toBeNull());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(STORE.getState().request).toBeNull();
    expect(await answer).toMatchObject({ payload: { outcome: "expired" } });
  });
});
