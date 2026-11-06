import { ClientError } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedAgent } from "../state/useConnectedAgentsStore";

const mocks = vi.hoisted(() => ({
  fetchConversation: vi.fn(),
  findCachedConversation: vi.fn(),
  pinnedEncrypted: vi.fn(),
  fetchChannels: vi.fn(),
  fetchMyServers: vi.fn(),
  direct: new Set<string>(),
  cache: { list: vi.fn(), get: vi.fn(), search: vi.fn(), follow: vi.fn() },
  encrypted: vi.fn(),
}));

vi.mock("../../conversations/api/useConversation", () => ({
  fetchConversation: mocks.fetchConversation,
  findCachedConversation: mocks.findCachedConversation,
}));
vi.mock("../../conversations/api/useChannels", () => ({
  BROWSE_FILTER: { joinedOnly: false, includeArchived: false },
  fetchChannels: mocks.fetchChannels,
}));
vi.mock("../../e2ee/runtime/pins", () => ({ pinnedEncrypted: mocks.pinnedEncrypted }));
vi.mock("../../workspaces/api/useMyServers", () => ({ fetchMyServers: mocks.fetchMyServers }));
vi.mock("../../relay/state/useRelayStore", () => ({
  isDirectSpace: (id: string) => mocks.direct.has(id),
}));
vi.mock("../../plugins/chat/appMessageService", () => ({
  appChatDeps: {
    workspaceId: () => "the-open-workspace",
    encrypted: mocks.encrypted,
    cache: () => mocks.cache,
    post: vi.fn(),
    recordEncryptedReads: vi.fn(),
  },
}));

import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { appAgentReads } from "./appAgentReads";

const AGENT: ConnectedAgent = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: { w1: { all: true, channelIds: [] } },
};
const DENIED =
  "You have no grant for this channel. The person can grant it in RIM's Settings > Agents.";

function conversation(fields: Record<string, unknown> = {}) {
  return {
    id: "c1",
    title: "general",
    conversationType: "CHANNEL",
    isPrivate: false,
    encryptedAt: null,
    ...fields,
  };
}

function read() {
  return appAgentReads.readMessages(AGENT, { workspaceId: "w1", channelId: "c1" });
}

function refusalText(outcome: { payload: object }) {
  return (outcome.payload as { message?: string }).message;
}

describe("appAgentReads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.direct.clear();
    mocks.pinnedEncrypted.mockResolvedValue(false);
    mocks.fetchConversation.mockResolvedValue(conversation());
    mocks.findCachedConversation.mockReturnValue(undefined);
    mocks.encrypted.mockResolvedValue(false);
    mocks.cache.list.mockResolvedValue({ messages: [], hasOlder: false });
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({ entries: [] });
  });

  it("reads a channel, asking its own workspace, and records it", async () => {
    expect((await read()).isError).toBe(false);
    expect(mocks.fetchConversation).toHaveBeenCalledWith(expect.anything(), "w1", "c1");
    expect(useAgentRecordStore.getState().entries).toHaveLength(1);
  });

  it("stamps a run on what it records, and keeps the agent's run across calls", async () => {
    await read();
    await read();
    const [first, second] = useAgentRecordStore.getState().entries;
    expect(first.runId).toMatch(/^r_[A-Za-z0-9_-]{16}$/);
    expect(second.runId).toBe(first.runId);
  });

  it("starts a new run after the agent's grants change, and not otherwise", async () => {
    await read();
    await read();
    await new Promise((resolve) => setTimeout(resolve, 5));
    useConnectedAgentsStore.getState().setGrants(AGENT.id, {});
    await read();
    const ids = useAgentRecordStore.getState().entries.map((entry) => entry.runId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("stamps a refused read with a run too", async () => {
    mocks.fetchConversation.mockResolvedValue(conversation({ conversationType: "DIRECT" }));
    await read();
    expect(useAgentRecordStore.getState().entries[0].runId).toMatch(/^r_/);
  });

  it.each(["DIRECT", "GROUP"])("refuses a %s conversation", async (conversationType) => {
    mocks.fetchConversation.mockResolvedValue(conversation({ conversationType }));
    expect(refusalText(await read())).toBe(DENIED);
    expect(mocks.cache.list).not.toHaveBeenCalled();
  });

  it("refuses when the server calls it encrypted", async () => {
    mocks.fetchConversation.mockResolvedValue(conversation({ encryptedAt: "2026-11-01" }));
    expect(refusalText(await read())).toBe(DENIED);
  });

  it("refuses when this device pinned it as encrypted, whatever the server says", async () => {
    mocks.pinnedEncrypted.mockResolvedValue(true);
    expect(refusalText(await read())).toBe(DENIED);
  });

  it("refuses when the pin cannot be read", async () => {
    mocks.pinnedEncrypted.mockRejectedValue(new Error("no"));
    expect(refusalText(await read())).toBe(DENIED);
  });

  it("refuses when the server says no, even with the conversation still in the app's lists", async () => {
    mocks.fetchConversation.mockRejectedValue(
      new ClientError({ status: 200, errors: [] } as never, { query: "" }),
    );
    mocks.findCachedConversation.mockReturnValue(conversation());
    expect(refusalText(await read())).toBe(DENIED);
    expect(mocks.findCachedConversation).not.toHaveBeenCalled();
  });

  it("falls back on the app's lists when the server fails rather than answers", async () => {
    mocks.fetchConversation.mockRejectedValue(
      new ClientError({ status: 503, errors: [] } as never, { query: "" }),
    );
    mocks.findCachedConversation.mockReturnValue(conversation());
    expect((await read()).isError).toBe(false);
  });

  it("falls back on the app's lists when no server answered", async () => {
    mocks.fetchConversation.mockRejectedValue(new TypeError("no network"));
    mocks.findCachedConversation.mockReturnValue(conversation());
    expect((await read()).isError).toBe(false);
  });

  it("refuses when no server answered and the lists do not hold it", async () => {
    mocks.fetchConversation.mockRejectedValue(new TypeError("no network"));
    expect(refusalText(await read())).toBe(DENIED);
  });

  it("refuses the record's writing when the agent left the store during the read", async () => {
    mocks.cache.list.mockImplementation(async () => {
      useConnectedAgentsStore.setState({ agents: [] });
      return { messages: [], hasOlder: false };
    });
    expect(refusalText(await read())).toBe("RIM could not read this.");
    expect(useAgentRecordStore.getState().entries).toEqual([]);
  });

  it("lists no direct space among the workspaces", async () => {
    mocks.direct.add("w1");
    mocks.fetchMyServers.mockResolvedValue([{ id: "w1", name: "Direct", owner: null }]);
    const outcome = await appAgentReads.listWorkspaces({
      ...AGENT,
      grants: { w1: { all: true, channelIds: [] }, w2: { all: true, channelIds: [] } },
    });
    expect(outcome.payload).toEqual({ untrusted: true, workspaces: [] });
  });

  it("lists a channel by its title and privacy, without what the device pinned encrypted", async () => {
    mocks.fetchChannels.mockResolvedValue({
      items: [
        conversation({ id: "c1", title: "general" }),
        conversation({ id: "c2", title: "team", isPrivate: true }),
        conversation({ id: "c3", title: "server says encrypted", encryptedAt: "2026-11-01" }),
        conversation({ id: "c4", title: "device says encrypted" }),
      ],
    });
    mocks.pinnedEncrypted.mockImplementation(async (_workspace, id) => id === "c4");
    const outcome = await appAgentReads.listChannels(AGENT, { workspaceId: "w1" });
    expect(mocks.fetchChannels).toHaveBeenCalledWith("w1", {
      joinedOnly: false,
      includeArchived: false,
    });
    expect(outcome.payload).toEqual({
      untrusted: true,
      channels: [
        { id: "c1", name: "general", private: false },
        { id: "c2", name: "team", private: true },
      ],
    });
  });
});
