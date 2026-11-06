import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../core/logger";
import type { PluginChatMessage } from "../../plugins/chat/chatTypes";
import type { ChatCache, ChatDeps } from "../../plugins/chat/messageService";
import { ErrorCode, RpcError } from "../../plugins/web/rpc";
import type { RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { createAgentReads, type AgentReadsDeps } from "./agentReads";
import type { AgentGrants, GrantChannel } from "./grants";

const serviceCalls = vi.hoisted(() => [] as { method: string; granted: readonly string[] }[]);
vi.mock("../../plugins/chat/messageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugins/chat/messageService")>();
  return {
    ...actual,
    createMessageService: (deps: ChatDeps) => {
      const service = actual.createMessageService(deps);
      return {
        call: (pluginId: string, method: string, params: unknown, granted: readonly string[]) => {
          serviceCalls.push({ method, granted });
          return service.call(pluginId, method, params, granted);
        },
      };
    },
  };
});

const DENIED = {
  isError: true,
  payload: {
    refusal: "DENIED",
    message:
      "You have no grant for this channel. The person can grant it in RIM's Settings > Agents.",
  },
};
const NOT_STORED = {
  isError: true,
  payload: {
    refusal: "FAILED",
    message: "This channel is not stored on this device yet. Try again shortly.",
  },
};
const FAILED = {
  isError: true,
  payload: { refusal: "FAILED", message: "RIM could not read this." },
};

const SECRET_TEXT = "the secret message text";

function message(id: string, conversationId = "c1"): PluginChatMessage {
  return {
    id,
    conversationId,
    threadId: null,
    author: { principalId: "rimp1_author", displayName: "Ana" },
    text: SECRET_TEXT,
    sentAt: "2026-11-06T10:00:00.000Z",
    editedAt: null,
    encrypted: false,
    attachments: [],
  };
}

function agentWith(grants: AgentGrants): ConnectedAgent {
  return {
    id: "agent-1",
    name: "Claude Code",
    tokenHash: "hash",
    pairedAt: "2026-11-06T10:00:00.000Z",
    grants,
  };
}

const ALL = agentWith({ w1: { all: true, channelIds: [] } });
const BY_ID = agentWith({ w1: { all: false, channelIds: ["c1"] } });

const CHANNELS: Record<string, GrantChannel | null> = {
  c1: { id: "c1", isChannel: true, encrypted: false },
  c2: { id: "c2", isChannel: true, encrypted: false },
  dm: { id: "dm", isChannel: false, encrypted: false },
  group: { id: "group", isChannel: false, encrypted: false },
  secret: { id: "secret", isChannel: true, encrypted: true },
};

let cache: { [K in keyof ChatCache]: ReturnType<typeof vi.fn> };
let chat: ChatDeps;
let recorded: RecordEntry[];
let deps: AgentReadsDeps & {
  lookup: ReturnType<typeof vi.fn>;
  workspaces: ReturnType<typeof vi.fn>;
  channels: ReturnType<typeof vi.fn>;
  isDirectSpace: ReturnType<typeof vi.fn>;
  connected: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
};

function reads() {
  return createAgentReads(deps);
}

function args(channelId: unknown, workspaceId: unknown = "w1") {
  return { workspaceId: workspaceId ?? undefined, channelId };
}

function lastEntry(): RecordEntry {
  return recorded[recorded.length - 1];
}

beforeEach(() => {
  serviceCalls.length = 0;
  recorded = [];
  cache = {
    list: vi.fn(async () => ({ messages: [message("m1")], hasOlder: false })),
    get: vi.fn(async () => null),
    search: vi.fn(async () => [message("m1")]),
    follow: vi.fn(async () => undefined),
  };
  chat = {
    workspaceId: () => "the-open-workspace",
    encrypted: vi.fn(async () => false),
    cache: () => cache as unknown as ChatCache,
    post: vi.fn(async () => "posted"),
    recordEncryptedReads: vi.fn(async () => undefined),
  };
  deps = {
    chat,
    lookup: vi.fn(async (_workspace: string, id: string) => CHANNELS[id] ?? null),
    workspaces: vi.fn(async () => [
      { id: "w1", name: "Acme", owner: { id: "secret-owner" } },
      { id: "w2", name: "Other" },
    ]),
    channels: vi.fn(async () => [
      { ...CHANNELS.c1, name: "general", private: false, topic: "secret topic" },
      { ...CHANNELS.c2, name: "team", private: true },
      { ...CHANNELS.secret, name: "hidden", private: true },
    ]),
    isDirectSpace: vi.fn(() => false),
    connected: vi.fn(() => true),
    record: vi.fn(async (entry: RecordEntry) => {
      recorded.push(entry);
    }),
  };
});

describe("rim_read_messages", () => {
  it("returns only the listed fields of a message, and marks it untrusted", async () => {
    const extra = {
      ...message("m1"),
      threadId: "t1",
      editedAt: "2026-11-06T11:00:00.000Z",
      added: "a field nobody listed",
      attachments: [
        { name: "a.png", mime: "image/png", size: 3, url: "https://secret", key: "secret" },
      ],
    };
    cache.list.mockResolvedValue({ messages: [extra], hasOlder: true, added: "x" });
    const outcome = await reads().readMessages(BY_ID, args("c1"));
    expect(outcome).toEqual({
      isError: false,
      payload: {
        untrusted: true,
        hasOlder: true,
        messages: [
          {
            id: "m1",
            channelId: "c1",
            threadId: "t1",
            author: "Ana",
            text: SECRET_TEXT,
            sentAt: "2026-11-06T10:00:00.000Z",
            editedAt: "2026-11-06T11:00:00.000Z",
            attachments: [{ name: "a.png", mime: "image/png", size: 3 }],
          },
        ],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("rimp1_author");
  });

  it("names an author with no display name unknown", async () => {
    const nameless = { ...message("m1"), author: { principalId: "rimp1_author", displayName: "" } };
    cache.list.mockResolvedValue({ messages: [nameless], hasOlder: false });
    const outcome = await reads().readMessages(BY_ID, args("c1"));
    expect(outcome.payload).toMatchObject({ messages: [{ author: "unknown" }] });
  });

  it("gives the service exactly the plain read capability", async () => {
    await reads().readMessages(BY_ID, args("c1"));
    expect(serviceCalls).toEqual([{ method: "rim.chat.list_messages", granted: ["chat.read"] }]);
  });

  it("asks for 50 messages by default, and passes on the limit and the cursor", async () => {
    await reads().readMessages(BY_ID, args("c1"));
    expect(cache.list).toHaveBeenLastCalledWith("w1", "c1", null, 50, expect.anything());
    await reads().readMessages(BY_ID, { ...args("c1"), before: "m9", limit: 3 });
    expect(cache.list).toHaveBeenLastCalledWith("w1", "c1", "m9", 3, expect.anything());
  });

  it.each([[0], [101], [1.5], ["10"]])("refuses a limit of %s", async (limit) => {
    expect(await reads().readMessages(BY_ID, { ...args("c1"), limit })).toEqual(FAILED);
    expect(cache.list).not.toHaveBeenCalled();
  });

  it("reads the given workspace, not the open one", async () => {
    await reads().readMessages(BY_ID, args("c1"));
    expect(chat.encrypted).toHaveBeenCalledWith("w1", "c1");
    expect(cache.list).toHaveBeenCalledWith("w1", "c1", null, 50, expect.anything());
    expect(deps.lookup).toHaveBeenCalledWith("w1", "c1");
  });

  describe("refusals are byte-identical", () => {
    const cases: [string, ConnectedAgent, unknown, unknown][] = [
      ["no grant in the workspace", agentWith({}), "c1", "w1"],
      ["a channel not granted", BY_ID, "c2", "w1"],
      ["a made-up channel not granted", BY_ID, "made-up", "w1"],
      ["a made-up channel under all", ALL, "made-up", "w1"],
      ["a direct message under all", ALL, "dm", "w1"],
      ["a group under all", ALL, "group", "w1"],
      ["an encrypted channel under all", ALL, "secret", "w1"],
      [
        "a direct message listed by id",
        agentWith({ w1: { all: false, channelIds: ["dm"] } }),
        "dm",
        "w1",
      ],
      [
        "an encrypted channel listed by id",
        agentWith({ w1: { all: false, channelIds: ["secret"] } }),
        "secret",
        "w1",
      ],
      ["no channel", ALL, undefined, "w1"],
      ["a channel that is not a string", ALL, 7, "w1"],
      ["a channel that is too long", ALL, "c".repeat(129), "w1"],
      ["no workspace", ALL, "c1", null],
      ["a workspace from the object prototype", ALL, "c1", "constructor"],
    ];

    it.each(cases)("%s", async (_what, agent, channelId, workspaceId) => {
      const outcome = await reads().readMessages(agent, args(channelId, workspaceId));
      expect(JSON.stringify(outcome)).toBe(JSON.stringify(DENIED));
      expect(lastEntry()).toMatchObject({
        tool: "rim_read_messages",
        refused: true,
        messageIds: [],
      });
    });

    it.each(cases)(
      "%s reaches neither list nor follow",
      async (_what, agent, channelId, workspaceId) => {
        await reads().readMessages(agent, args(channelId, workspaceId));
        expect(cache.list).not.toHaveBeenCalled();
        expect(cache.follow).not.toHaveBeenCalled();
      },
    );
  });

  it("looks nothing up for an id no grant could cover", async () => {
    await reads().readMessages(BY_ID, args("c2"));
    await reads().readMessages(agentWith({}), args("c1"));
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it("refuses when the lookup fails", async () => {
    deps.lookup.mockRejectedValue(new Error("no network"));
    expect(await reads().readMessages(ALL, args("c1"))).toEqual(DENIED);
  });

  it("refuses a direct space, even with a grant in it", async () => {
    deps.isDirectSpace.mockReturnValue(true);
    expect(await reads().readMessages(ALL, args("c1"))).toEqual(DENIED);
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  describe("the service as the guarantee", () => {
    it("answers the same refusal when it finds the channel encrypted after the grant check", async () => {
      vi.mocked(chat.encrypted).mockResolvedValue(true);
      expect(await reads().readMessages(ALL, args("c1"))).toEqual(DENIED);
      expect(cache.list).not.toHaveBeenCalled();
    });

    it("answers the same refusal when it finds the conversation unknown", async () => {
      vi.mocked(chat.encrypted).mockResolvedValue(null);
      expect(await reads().readMessages(ALL, args("c1"))).toEqual(DENIED);
    });

    it("answers the same refusal when the cache says it is encrypted", async () => {
      cache.list.mockRejectedValue({ code: "CAPABILITY_DENIED", message: "encrypted" });
      expect(await reads().readMessages(ALL, args("c1"))).toEqual(DENIED);
      expect(lastEntry()).toMatchObject({ refused: true, messageIds: [] });
    });

    it("tells the cache nothing encrypted is allowed", async () => {
      await reads().readMessages(ALL, args("c1"));
      expect(cache.list.mock.calls[0][4]).toEqual({ encryptedAllowed: false, knownEncrypted: [] });
    });
  });

  it("says to try again when the channel is not stored yet, and starts storing it", async () => {
    cache.list.mockResolvedValue(null);
    expect(await reads().readMessages(ALL, args("c1"))).toEqual(NOT_STORED);
    expect(cache.follow).toHaveBeenCalledWith("w1", "c1");
    expect(lastEntry()).toMatchObject({ refused: true, messageIds: [] });
  });

  it("lets nothing of an unknown failure reach the agent", async () => {
    const secret = "failure with a secret detail";
    for (const failure of [
      new Error(secret),
      new RpcError(ErrorCode.INTERNAL_ERROR, secret, { reason: "noCache" }),
      { message: secret },
      secret,
    ]) {
      cache.list.mockRejectedValue(failure);
      const outcome = await reads().readMessages(ALL, args("c1"));
      expect(outcome).toEqual(FAILED);
      expect(JSON.stringify(outcome)).not.toContain("secret");
    }
  });
});

describe("rim_search_messages", () => {
  const query = { workspaceId: "w1", query: "the secret query" };

  it("searches the given workspace with the plain read capability", async () => {
    await reads().searchMessages(ALL, query);
    expect(cache.search).toHaveBeenCalledWith("w1", "the secret query", null, 100, {
      encryptedAllowed: false,
      knownEncrypted: [],
    });
    expect(serviceCalls).toEqual([{ method: "rim.chat.search_messages", granted: ["chat.read"] }]);
  });

  it("keeps only the listed fields, and marks them untrusted", async () => {
    cache.search.mockResolvedValue([{ ...message("m1"), added: "x" }]);
    const outcome = await reads().searchMessages(BY_ID, query);
    expect(outcome).toEqual({
      isError: false,
      payload: {
        untrusted: true,
        messages: [
          {
            id: "m1",
            channelId: "c1",
            threadId: null,
            author: "Ana",
            text: SECRET_TEXT,
            sentAt: "2026-11-06T10:00:00.000Z",
            editedAt: null,
            attachments: [],
          },
        ],
      },
    });
  });

  it("drops hits outside the grant and records only what it returned", async () => {
    cache.search.mockResolvedValue([
      message("m1", "c1"),
      message("m2", "c2"),
      message("m3", "dm"),
      message("m4", "secret"),
      message("m5", "c1"),
    ]);
    const outcome = await reads().searchMessages(BY_ID, query);
    expect(outcome.payload).toMatchObject({ messages: [{ id: "m1" }, { id: "m5" }] });
    expect(lastEntry()).toMatchObject({
      tool: "rim_search_messages",
      channelId: null,
      workspaceId: "w1",
      query: true,
      refused: false,
      messageIds: ["m1", "m5"],
    });
  });

  it("looks past hits outside the grant, then keeps to the limit", async () => {
    cache.search.mockResolvedValue([
      { ...message("outside"), conversationId: "c-other" },
      { ...message("m1"), conversationId: "c1" },
      { ...message("m2"), conversationId: "c1" },
    ]);
    const outcome = await reads().searchMessages(BY_ID, { ...query, limit: 1 });
    expect(cache.search).toHaveBeenCalledWith(
      "w1",
      "the secret query",
      null,
      100,
      expect.anything(),
    );
    expect((outcome.payload as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual([
      "m1",
    ]);
  });

  it("refuses a limit outside the range, with no search", async () => {
    for (const limit of [0, 101, 1.5, "10"]) {
      const outcome = await reads().searchMessages(ALL, { ...query, limit });
      expect((outcome.payload as { refusal: string }).refusal).toBe("FAILED");
    }
    expect(cache.search).not.toHaveBeenCalled();
  });

  it("drops direct messages and encrypted channels from search under all", async () => {
    cache.search.mockResolvedValue([
      message("m1", "c1"),
      message("m2", "c2"),
      message("m3", "dm"),
      message("m4", "group"),
      message("m5", "secret"),
      message("m6", "gone"),
    ]);
    const outcome = await reads().searchMessages(ALL, query);
    expect(outcome.payload).toMatchObject({ messages: [{ id: "m1" }, { id: "m2" }] });
    expect(lastEntry().messageIds).toEqual(["m1", "m2"]);
  });

  it("drops what the service finds encrypted", async () => {
    vi.mocked(chat.encrypted).mockImplementation(async (_w, id) => id === "c2");
    cache.search.mockResolvedValue([message("m1", "c1"), message("m2", "c2")]);
    const outcome = await reads().searchMessages(ALL, query);
    expect(outcome.payload).toMatchObject({ messages: [{ id: "m1" }] });
    expect(JSON.stringify(outcome)).not.toContain("m2");
  });

  it("looks each conversation up once", async () => {
    cache.search.mockResolvedValue([message("m1"), message("m2"), message("m3")]);
    await reads().searchMessages(ALL, query);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it("does not run a search in a workspace with no grant", async () => {
    for (const agent of [agentWith({}), agentWith({ w1: { all: false, channelIds: [] } })]) {
      expect(await reads().searchMessages(agent, query)).toEqual(DENIED);
    }
    expect(cache.search).not.toHaveBeenCalled();
    expect(lastEntry()).toMatchObject({ query: true, refused: true });
  });

  it("does not search a direct space", async () => {
    deps.isDirectSpace.mockReturnValue(true);
    expect(await reads().searchMessages(ALL, query)).toEqual(DENIED);
    expect(cache.search).not.toHaveBeenCalled();
  });

  describe("with a channelId", () => {
    it("searches that channel", async () => {
      await reads().searchMessages(BY_ID, { ...query, channelId: "c1", limit: 5 });
      expect(cache.search).toHaveBeenCalledWith("w1", "the secret query", "c1", 5, {
        encryptedAllowed: false,
        knownEncrypted: [],
      });
      expect(lastEntry()).toMatchObject({ channelId: "c1", messageIds: ["m1"] });
    });

    it.each([
      ["not granted", BY_ID, "c2"],
      ["a made-up id", BY_ID, "made-up"],
      ["a direct message under all", ALL, "dm"],
      ["encrypted under all", ALL, "secret"],
      ["unknown under all", ALL, "made-up"],
    ])("gives the same refusal for %s", async (_what, agent, channelId) => {
      const outcome = await reads().searchMessages(agent, { ...query, channelId });
      expect(JSON.stringify(outcome)).toBe(JSON.stringify(DENIED));
      expect(cache.search).not.toHaveBeenCalled();
      expect(lastEntry()).toMatchObject({ refused: true, query: true });
    });

    it.each([[""], [7], [{}]])(
      "refuses a channelId of %j rather than searching everything",
      async (channelId) => {
        expect(await reads().searchMessages(ALL, { ...query, channelId })).toEqual(DENIED);
        expect(cache.search).not.toHaveBeenCalled();
      },
    );

    it("takes a null channelId as none", async () => {
      await reads().searchMessages(ALL, { ...query, channelId: null });
      expect(cache.search).toHaveBeenCalledWith(
        "w1",
        "the secret query",
        null,
        100,
        expect.anything(),
      );
    });
  });

  it.each([[undefined], [7], [""], ["q".repeat(501)]])("refuses a query of %j", async (bad) => {
    const outcome = await reads().searchMessages(ALL, { workspaceId: "w1", query: bad });
    expect(outcome).toEqual(FAILED);
    expect(cache.search).not.toHaveBeenCalled();
  });

  it("keeps the query out of the record and out of the log", async () => {
    const warn = vi.spyOn(logger, "warn");
    await reads().searchMessages(ALL, query);
    deps.record.mockRejectedValue(new Error("no"));
    await reads().searchMessages(ALL, query);
    expect(JSON.stringify(recorded)).not.toContain("the secret query");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("the secret query");
    warn.mockRestore();
  });
});

describe("rim_list_workspaces", () => {
  it("is empty with no grant, without asking anyone", async () => {
    for (const agent of [agentWith({}), agentWith({ w1: { all: false, channelIds: [] } })]) {
      const outcome = await reads().listWorkspaces(agent);
      expect(outcome).toEqual({ isError: false, payload: { untrusted: true, workspaces: [] } });
    }
    expect(deps.workspaces).not.toHaveBeenCalled();
    expect(lastEntry()).toMatchObject({ tool: "rim_list_workspaces", refused: false });
  });

  it("lists only workspaces with a grant, by id and name alone", async () => {
    expect(await reads().listWorkspaces(BY_ID)).toEqual({
      isError: false,
      payload: { untrusted: true, workspaces: [{ id: "w1", name: "Acme" }] },
    });
  });

  it("leaves out a direct space with a grant in it", async () => {
    deps.isDirectSpace.mockImplementation((id: string) => id === "w1");
    const outcome = await reads().listWorkspaces(ALL);
    expect(outcome.payload).toEqual({ untrusted: true, workspaces: [] });
  });

  it("refuses when the workspaces cannot be listed", async () => {
    deps.workspaces.mockRejectedValue(new Error("a secret detail"));
    expect(await reads().listWorkspaces(ALL)).toEqual(FAILED);
    expect(lastEntry()).toMatchObject({ refused: true });
  });
});

describe("rim_list_channels", () => {
  it("lists what the grant covers, by id, name and privacy alone", async () => {
    expect(await reads().listChannels(ALL, { workspaceId: "w1" })).toEqual({
      isError: false,
      payload: {
        untrusted: true,
        channels: [
          { id: "c1", name: "general", private: false },
          { id: "c2", name: "team", private: true },
        ],
      },
    });
    const outcome = await reads().listChannels(BY_ID, { workspaceId: "w1" });
    expect(outcome.payload).toEqual({
      untrusted: true,
      channels: [{ id: "c1", name: "general", private: false }],
    });
  });

  it.each([
    ["no grant", agentWith({}), "w1"],
    ["a grant that names nothing", agentWith({ w1: { all: false, channelIds: [] } }), "w1"],
    ["another workspace's grant", ALL, "w2"],
    ["no workspace", ALL, undefined],
  ])("gives the usual refusal for %s", async (_what, agent, workspaceId) => {
    const outcome = await reads().listChannels(agent, { workspaceId });
    expect(JSON.stringify(outcome)).toBe(JSON.stringify(DENIED));
    expect(deps.channels).not.toHaveBeenCalled();
    expect(lastEntry()).toMatchObject({ tool: "rim_list_channels", refused: true });
  });

  it("refuses a direct space", async () => {
    deps.isDirectSpace.mockReturnValue(true);
    expect(await reads().listChannels(ALL, { workspaceId: "w1" })).toEqual(DENIED);
  });

  it("lets nothing of a failure reach the agent", async () => {
    deps.channels.mockRejectedValue(new Error("a secret detail"));
    const outcome = await reads().listChannels(ALL, { workspaceId: "w1" });
    expect(outcome).toEqual(FAILED);
  });
});

describe("the record", () => {
  it("is written before the read is returned", async () => {
    let release: () => void = () => undefined;
    deps.record.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let settled = false;
    const reading = reads()
      .readMessages(BY_ID, args("c1"))
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    await vi.waitFor(() => expect(deps.record).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect((await reading).isError).toBe(false);
  });

  it("says when, who, what and which messages for a read", async () => {
    await reads().readMessages(BY_ID, args("c1"));
    expect(recorded).toEqual([
      {
        at: expect.any(String),
        agentId: "agent-1",
        agentName: "Claude Code",
        tool: "rim_read_messages",
        workspaceId: "w1",
        channelId: "c1",
        query: false,
        messageIds: ["m1"],
        refused: false,
      },
    ]);
  });

  it.each([
    ["rim_read_messages", (agent: ConnectedAgent) => reads().readMessages(agent, args("c1"))],
    [
      "rim_search_messages",
      (agent: ConnectedAgent) => reads().searchMessages(agent, { workspaceId: "w1", query: "q" }),
    ],
    ["rim_list_workspaces", (agent: ConnectedAgent) => reads().listWorkspaces(agent)],
    [
      "rim_list_channels",
      (agent: ConnectedAgent) => reads().listChannels(agent, { workspaceId: "w1" }),
    ],
  ])("refuses %s when it cannot be written, with no content", async (_tool, run) => {
    deps.record.mockRejectedValue(new Error("the record failed"));
    const outcome = await run(ALL);
    expect(outcome).toEqual(FAILED);
    expect(JSON.stringify(outcome)).not.toContain(SECRET_TEXT);
  });

  it("refuses when the store throws as it adds", async () => {
    deps.record.mockImplementation(() => {
      throw new Error("the store threw");
    });
    expect(await reads().readMessages(ALL, args("c1"))).toEqual(FAILED);
  });

  it("keeps a refusal the same when the refusal itself cannot be recorded", async () => {
    deps.record.mockRejectedValue(new Error("the record failed"));
    expect(await reads().readMessages(agentWith({}), args("c1"))).toEqual(DENIED);
  });

  it("hands nothing over, and writes nothing, once the account locked during the read", async () => {
    deps.connected.mockReturnValue(false);
    const outcome = await reads().readMessages(ALL, args("c1"));
    expect(outcome).toEqual(FAILED);
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("keeps an id that could not be one out of the record", async () => {
    await reads().readMessages(ALL, args("<script>", "w".repeat(1000)));
    expect(lastEntry()).toMatchObject({ workspaceId: "", channelId: null, refused: true });
  });
});

it("applies a revoked grant to the next call", async () => {
  const agent = agentWith({ w1: { all: false, channelIds: ["c1"] } });
  expect((await reads().readMessages(agent, args("c1"))).isError).toBe(false);
  const revoked = { ...agent, grants: {} };
  expect(await reads().readMessages(revoked, args("c1"))).toEqual(DENIED);
  expect(lastEntry()).toMatchObject({ refused: true });
});

it("cannot reach the post path through any tool", async () => {
  const run = reads();
  await run.listWorkspaces(ALL);
  await run.listChannels(ALL, { workspaceId: "w1" });
  await run.readMessages(ALL, { ...args("c1"), method: "rim.chat.post_message", body: "x" });
  await run.searchMessages(ALL, { workspaceId: "w1", query: "q", body: "x" });
  expect(chat.post).not.toHaveBeenCalled();
  expect(serviceCalls.map((call) => call.method).sort()).toEqual([
    "rim.chat.list_messages",
    "rim.chat.search_messages",
  ]);
  for (const call of serviceCalls) expect(call.granted).toEqual(["chat.read"]);
});
