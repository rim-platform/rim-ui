import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lockVault } from "../../../core/accountVault/accountVault";
import { readSealedItem, writeSealedItem } from "../../../core/accountVault/sealedStorage";
import { unlockTestVault } from "../../../test/accountVault";
import type { PluginChatMessage } from "../../plugins/chat/chatTypes";
import { createAgentReads } from "../runtime/agentReads";
import { CLEARED_TOOL, useAgentRecordStore, type RecordEntry } from "./useAgentRecordStore";
import type { ConnectedAgent } from "./useConnectedAgentsStore";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function entry(at: number, id = "m1"): RecordEntry {
  return {
    at: new Date(at).toISOString(),
    agentId: "agent-1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "w1",
    channelId: "c1",
    query: false,
    messageIds: [id],
    refused: false,
  };
}

describe("useAgentRecordStore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    useAgentRecordStore.setState({ entries: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prunes entries older than 30 days as it adds", () => {
    const { add } = useAgentRecordStore.getState();
    add(entry(NOW - 31 * DAY, "too-old"));
    add(entry(NOW - 29 * DAY, "young-enough"));
    add(entry(NOW, "new"));
    expect(useAgentRecordStore.getState().entries.map((e) => e.messageIds[0])).toEqual([
      "young-enough",
      "new",
    ]);
  });

  it("keeps at most the newest 5,000", () => {
    useAgentRecordStore.setState({
      entries: Array.from({ length: 5000 }, (_, i) => entry(NOW - 1000 + i, `m${i}`)),
    });
    useAgentRecordStore.getState().add(entry(NOW, "newest"));
    const { entries } = useAgentRecordStore.getState();
    expect(entries).toHaveLength(5000);
    expect(entries[0].messageIds).toEqual(["m1"]);
    expect(entries[4999].messageIds).toEqual(["newest"]);
  });

  it("leaves one entry saying it was cleared, and nothing else", () => {
    const { add, clear } = useAgentRecordStore.getState();
    add(entry(NOW));
    clear();
    expect(useAgentRecordStore.getState().entries).toEqual([
      {
        at: new Date(NOW).toISOString(),
        agentId: "",
        agentName: "",
        tool: CLEARED_TOOL,
        workspaceId: "",
        channelId: null,
        query: false,
        messageIds: [],
        refused: false,
      },
    ]);
  });

  it("holds neither the text nor the query after a read", async () => {
    const message: PluginChatMessage = {
      id: "m1",
      conversationId: "c1",
      threadId: null,
      author: { principalId: "rimp1_author", displayName: "Ana" },
      text: "the secret text",
      sentAt: "2026-11-06T10:00:00.000Z",
      editedAt: null,
      encrypted: false,
      attachments: [{ name: "secret-name.png", mime: "image/png", size: 3 }],
    };
    const agent: ConnectedAgent = {
      id: "agent-1",
      name: "Claude Code",
      tokenHash: "hash",
      pairedAt: "2026-11-06T10:00:00.000Z",
      grants: { w1: { all: true, channelIds: [] } },
    };
    const reads = createAgentReads({
      chat: {
        workspaceId: () => null,
        encrypted: async () => false,
        cache: () => ({
          list: async () => ({ messages: [message], hasOlder: false }),
          get: async () => null,
          search: async () => [message],
          follow: async () => undefined,
        }),
        post: async () => "",
        recordEncryptedReads: async () => undefined,
      },
      lookup: async () => ({ id: "c1", isChannel: true, encrypted: false }),
      workspaces: async () => [],
      channels: async () => [],
      isDirectSpace: () => false,
      connected: () => true,
      record: async (recorded) => useAgentRecordStore.getState().add(recorded),
    });

    const read = await reads.readMessages(agent, { workspaceId: "w1", channelId: "c1" });
    const found = await reads.searchMessages(agent, {
      workspaceId: "w1",
      query: "the secret query",
    });

    expect(JSON.stringify(read)).toContain("the secret text");
    expect(JSON.stringify(found)).toContain("the secret text");
    const stored = JSON.stringify(useAgentRecordStore.getState());
    expect(useAgentRecordStore.getState().entries).toHaveLength(2);
    expect(stored).not.toContain("the secret text");
    expect(stored).not.toContain("the secret query");
    expect(stored).not.toContain("secret-name");
  });

  describe("sealed under the account vault", () => {
    afterEach(() => {
      lockVault();
    });

    it("drops what is too old when the account unlocks, and nothing while locked", async () => {
      await unlockTestVault();
      writeSealedItem(
        "rim-agent-record",
        JSON.stringify({
          state: { entries: [entry(NOW - 31 * DAY, "too-old"), entry(NOW - DAY, "kept")] },
          version: 0,
        }),
      );
      lockVault();
      expect(useAgentRecordStore.getState().entries).toEqual([]);

      await unlockTestVault();
      writeSealedItem(
        "rim-agent-record",
        JSON.stringify({
          state: { entries: [entry(NOW - 31 * DAY, "too-old"), entry(NOW - DAY, "kept")] },
          version: 0,
        }),
      );
      await useAgentRecordStore.persist.rehydrate();
      expect(useAgentRecordStore.getState().entries.map((e) => e.messageIds[0])).toEqual(["kept"]);
    });

    it("writes to the sealed store under its name", async () => {
      await unlockTestVault();
      useAgentRecordStore.getState().add(entry(NOW));
      expect(readSealedItem("rim-agent-record")).toContain("rim_read_messages");
    });
  });
});
