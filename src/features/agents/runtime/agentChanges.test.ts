import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandResultStatus,
  type CommandResult,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import type { RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { createAgentChanges, createCooldown, type AgentChangesDeps } from "./agentChanges";
import { createAgentReads } from "./agentReads";
import type { AgentGrants, GrantChannel } from "./grants";

const TEXT = "the words the person confirms";
const EXPIRES_AT = 1_000_000;
const CHALLENGE = {
  token: "tok",
  argsHash: "hash",
  expiresAt: new Date(EXPIRES_AT).toISOString(),
};
const PROOF = { inBandToken: { token: "tok", argsHash: "hash" } };

const INVALID = {
  isError: true,
  payload: { refusal: "INVALID", message: "Give workspaceId, channelId and text." },
};
const COOLING_DOWN = {
  isError: true,
  payload: { refusal: "FAILED", retrySafe: true, message: "Wait ten seconds, then try again." },
};
const BUSY = {
  isError: true,
  payload: {
    refusal: "FAILED",
    retrySafe: true,
    message: "The person is answering something else in RIM. Try again shortly.",
  },
};
const EXPIRED = {
  isError: true,
  payload: {
    outcome: "expired",
    message: "The person didn't answer in time. Nothing was sent. Ask them before trying again.",
  },
};
const DISCARDED = {
  isError: true,
  payload: {
    outcome: "discarded",
    message: "The person chose not to send this. Do not send it again unless they ask.",
  },
};
const FAILED = {
  isError: true,
  payload: { refusal: "FAILED", message: "RIM could not send this." },
};
const DENIED = {
  isError: true,
  payload: {
    refusal: "DENIED",
    message:
      "You have no grant for this channel. The person can grant it in RIM's Settings > Agents.",
  },
};

function agentWith(grants: AgentGrants, id = "agent-1"): ConnectedAgent {
  return {
    id,
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
  dm: { id: "dm", isChannel: false, encrypted: false },
  group: { id: "group", isChannel: false, encrypted: false },
  secret: { id: "secret", isChannel: true, encrypted: true },
  unknown: null,
};

const ARGS = { workspaceId: "w1", channelId: "c1", text: TEXT };

function held(challenge: unknown = CHALLENGE): CommandResult {
  return {
    status: CommandResultStatus.CONFIRMATION_REQUIRED,
    message: "needs confirmation",
    followUpCommands: [],
    confirmationRequired: challenge,
  } as CommandResult;
}

function posted(payload: unknown = { message_id: "m1", conversation_id: "c1" }): CommandResult {
  return {
    status: CommandResultStatus.SUCCESS,
    message: "message posted",
    followUpCommands: [],
    payload,
  } as CommandResult;
}

/** An error as `graphqlClient.request` throws one. */
function serverError(code: string, message: string, extensions: object = {}) {
  return Object.assign(new Error(message), {
    response: { errors: [{ message, extensions: { code, ...extensions } }] },
  });
}

let clock: number;
let entries: RecordEntry[];
let deps: { [K in keyof AgentChangesDeps]: AgentChangesDeps[K] & ReturnType<typeof vi.fn> };
let changes: ReturnType<typeof createAgentChanges>;

function changesRecorded() {
  return entries.map((entry) => entry.change);
}

function proofs() {
  return deps.post.mock.calls.map(([input]) => (input as { proof?: unknown }).proof);
}

describe("createAgentChanges", () => {
  beforeEach(() => {
    clock = EXPIRES_AT - 30_000;
    entries = [];
    deps = {
      lookup: vi.fn((_workspaceId: string, channelId: string) =>
        Promise.resolve(CHANNELS[channelId] ?? null),
      ),
      workspaces: vi.fn(() => Promise.resolve([{ id: "w1", name: "Acme" }])),
      isDirectSpace: vi.fn(() => false),
      connected: vi.fn(() => true),
      channelName: vi.fn(() => Promise.resolve("general")),
      busy: vi.fn(() => false),
      post: vi.fn(() => Promise.resolve(posted())),
      confirm: vi.fn(() => Promise.resolve("approved" as const)),
      record: vi.fn((entry: RecordEntry) => {
        entries.push(entry);
        return Promise.resolve();
      }),
      cooldown: createCooldown(() => clock),
      now: vi.fn(() => clock),
    } as unknown as typeof deps;
    deps.post.mockResolvedValueOnce(held());
    changes = createAgentChanges(deps);
  });

  afterEach(() => {
    // Whatever the path, the words stay out of the record.
    expect(JSON.stringify(entries)).not.toContain(TEXT);
    vi.restoreAllMocks();
  });

  describe("what it refuses as invalid", () => {
    it.each([
      ["no workspace", { channelId: "c1", text: TEXT }],
      ["no channel", { workspaceId: "w1", text: TEXT }],
      ["no text", { workspaceId: "w1", channelId: "c1" }],
      ["a workspace id that is no id", { workspaceId: "w 1", channelId: "c1", text: TEXT }],
      ["a channel id that is no id", { workspaceId: "w1", channelId: {}, text: TEXT }],
      ["blank text", { workspaceId: "w1", channelId: "c1", text: " \n\t " }],
      ["empty text", { workspaceId: "w1", channelId: "c1", text: "" }],
      ["text that is no string", { workspaceId: "w1", channelId: "c1", text: 7 }],
    ])("refuses %s and records it refused", async (_what, args) => {
      expect(await changes.sendMessage(ALL, args)).toEqual(INVALID);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ refused: true, change: "refused", messageIds: [] });
      expect(deps.post).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
    });
  });

  describe("the grant", () => {
    const reads = () =>
      createAgentReads({
        chat: {} as never,
        lookup: deps.lookup,
        workspaces: deps.workspaces,
        channels: vi.fn(),
        isDirectSpace: deps.isDirectSpace,
        connected: deps.connected,
        record: deps.record,
      });

    it.each([
      ["a channel it has no grant for", BY_ID, { workspaceId: "w1", channelId: "c2" }],
      ["a workspace it has no grant in", ALL, { workspaceId: "w2", channelId: "c1" }],
      ["an unknown id", ALL, { workspaceId: "w1", channelId: "unknown" }],
      ["an encrypted channel", ALL, { workspaceId: "w1", channelId: "secret" }],
      ["a direct message", ALL, { workspaceId: "w1", channelId: "dm" }],
      ["a group", ALL, { workspaceId: "w1", channelId: "group" }],
    ])("answers %s byte for byte as a read does", async (_what, agent, target) => {
      const read = await reads().readMessages(agent, target);
      const sent = await changes.sendMessage(agent, { ...target, text: TEXT });
      expect(JSON.stringify(sent)).toBe(JSON.stringify(read));
      expect(sent).toEqual(DENIED);
      expect(entries.at(-1)).toMatchObject({ refused: true, change: "refused" });
      expect(deps.post).not.toHaveBeenCalled();
    });

    it("denies a covered channel in a workspace RIM does not list", async () => {
      deps.workspaces.mockResolvedValue([{ id: "elsewhere", name: "Other" }]);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DENIED);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ refused: true, change: "refused" });
      expect(deps.post).not.toHaveBeenCalled();
    });

    it("denies a direct space", async () => {
      deps.isDirectSpace.mockReturnValue(true);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DENIED);
      expect(deps.lookup).not.toHaveBeenCalled();
      expect(deps.post).not.toHaveBeenCalled();
    });

    it("looks up nothing the grant cannot cover", async () => {
      expect(await changes.sendMessage(BY_ID, { ...ARGS, channelId: "c2" })).toEqual(DENIED);
      expect(deps.lookup).not.toHaveBeenCalled();
    });

    it("denies when the lookup fails", async () => {
      deps.lookup.mockRejectedValue(new Error("down"));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DENIED);
      expect(deps.post).not.toHaveBeenCalled();
    });

    it("denies when the workspaces cannot be listed", async () => {
      deps.workspaces.mockRejectedValue(new Error("down"));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DENIED);
      expect(deps.post).not.toHaveBeenCalled();
    });

    it("treats an agent with no grants as having none", async () => {
      const agent = { ...ALL, grants: undefined };
      expect(await changes.sendMessage(agent, ARGS)).toEqual(DENIED);
    });
  });

  describe("the record of asking", () => {
    it("is kept before anything is posted", async () => {
      deps.post.mockReset();
      deps.post.mockImplementation(() => {
        expect(changesRecorded()).toEqual(["asked"]);
        return Promise.resolve(posted());
      });
      await changes.sendMessage(ALL, ARGS);
      expect(deps.post).toHaveBeenCalledOnce();
      expect(entries[0]).toEqual({
        at: new Date(clock).toISOString(),
        agentId: "agent-1",
        agentName: "Claude Code",
        tool: "rim_send_message",
        workspaceId: "w1",
        channelId: "c1",
        query: false,
        messageIds: [],
        refused: false,
        change: "asked",
      });
    });

    it("refuses and posts nothing when it cannot be kept", async () => {
      vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      deps.record.mockRejectedValue(new Error("no room"));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(FAILED);
      expect(deps.post).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
    });

    it("refuses and posts nothing when the agent is no longer connected", async () => {
      vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      deps.connected.mockReturnValue(false);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(FAILED);
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.post).not.toHaveBeenCalled();
    });
  });

  describe("the first post", () => {
    it("goes with the exact ids and text, and no proof", async () => {
      await changes.sendMessage(ALL, ARGS);
      expect(deps.post.mock.calls[0]).toEqual([{ workspaceId: "w1", channelId: "c1", text: TEXT }]);
    });

    it("passes no context of what the person has open", async () => {
      await changes.sendMessage(ALL, ARGS);
      for (const [input] of deps.post.mock.calls) {
        expect(Object.keys(input as object).sort()).toEqual(
          expect.not.arrayContaining(["context", "commandContext"]),
        );
      }
    });

    it("counts a SUCCESS with no challenge as sent", async () => {
      deps.post.mockReset();
      deps.post.mockResolvedValue(posted());
      expect(await changes.sendMessage(ALL, ARGS)).toEqual({
        isError: false,
        payload: { outcome: "sent", channelId: "c1", messageId: "m1" },
      });
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(changesRecorded()).toEqual(["asked", "sent"]);
    });

    it("answers a server's refusal in its own words, and records it", async () => {
      deps.post.mockReset();
      deps.post.mockRejectedValue(
        serverError("FEATURE_DISABLED", "off", { refusal: "DENIED", feature: "ai_commands" }),
      );
      const outcome = await changes.sendMessage(ALL, ARGS);
      expect(outcome).toMatchObject({
        isError: true,
        payload: { refusal: "DENIED", retrySafe: false },
      });
      expect((outcome.payload as { message: string }).message).toContain("Denied by policy");
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(changesRecorded()).toEqual(["asked", "refused"]);
      expect(entries[1].refused).toBe(true);
    });

    it("says when a failure is safe to retry", async () => {
      deps.post.mockReset();
      deps.post.mockRejectedValue(
        serverError("RATE_LIMITED", "slow", { refusal: "FAILED", retrySafe: true }),
      );
      expect(await changes.sendMessage(ALL, ARGS)).toMatchObject({
        payload: { refusal: "FAILED", retrySafe: true },
      });
    });

    it("answers an error it cannot read without passing on what it says", async () => {
      deps.post.mockReset();
      deps.post.mockRejectedValue(new Error(`failed with ${TEXT}`));
      const outcome = await changes.sendMessage(ALL, ARGS);
      expect(outcome).toEqual({
        isError: true,
        payload: {
          refusal: "FAILED",
          retrySafe: false,
          message: "RIM got no usable answer from the server. Ask the person before trying again.",
        },
      });
    });

    it("refuses CONFIRMATION_REQUIRED with no challenge", async () => {
      deps.post.mockReset();
      deps.post.mockResolvedValue(held(null));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(FAILED);
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(changesRecorded()).toEqual(["asked", "refused"]);
    });

    it("refuses a status of ERROR", async () => {
      deps.post.mockReset();
      deps.post.mockResolvedValue({ ...posted(), status: CommandResultStatus.ERROR });
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(FAILED);
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(changesRecorded()).toEqual(["asked", "refused"]);
    });
  });

  describe("the question", () => {
    it("shows the agent, the workspace, the channel and the exact text", async () => {
      await changes.sendMessage(ALL, ARGS);
      expect(deps.confirm).toHaveBeenCalledWith({
        agentName: "Claude Code",
        workspaceName: "Acme",
        channelName: "general",
        text: TEXT,
        expiresAt: CHALLENGE.expiresAt,
        token: "tok",
        argsHash: "hash",
      });
    });

    it("falls back on the id when the channel's name cannot be had", async () => {
      deps.channelName.mockRejectedValue(new Error("down"));
      await changes.sendMessage(ALL, ARGS);
      expect(deps.confirm).toHaveBeenCalledWith(expect.objectContaining({ channelName: "c1" }));
    });

    it("answers busy without asking the server or recording while a dialog is open", async () => {
      deps.busy.mockReturnValueOnce(true);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(BUSY);
      expect(deps.post).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(entries).toEqual([]);
    });

    it("answers busy with no cooldown and no proof sent", async () => {
      deps.confirm.mockResolvedValueOnce("busy");
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(BUSY);
      expect(changesRecorded()).toEqual(["asked", "busy"]);
      expect(entries[1].refused).toBe(false);
      expect(proofs()).toEqual([undefined]);

      deps.post.mockResolvedValueOnce(held());
      await changes.sendMessage(ALL, ARGS);
      expect(deps.confirm).toHaveBeenCalledTimes(2);
    });

    it("answers discarded before the expiry, and sends nothing", async () => {
      deps.confirm.mockResolvedValueOnce("discarded");
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DISCARDED);
      expect(changesRecorded()).toEqual(["asked", "discarded"]);
      expect(proofs()).toEqual([undefined]);
    });

    it.each([
      ["at", 0],
      ["after", 1],
    ])("answers expired %s the expiry, and sends nothing", async (_when, late) => {
      deps.confirm.mockImplementationOnce(() => {
        clock = EXPIRES_AT + late;
        return Promise.resolve("discarded");
      });
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(EXPIRED);
      expect(changesRecorded()).toEqual(["asked", "expired"]);
      expect(proofs()).toEqual([undefined]);
    });

    it("gives a different answer for a discard and for an expiry just past it", async () => {
      clock = EXPIRES_AT - 1;
      deps.confirm.mockResolvedValueOnce("discarded");
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DISCARDED);
    });
  });

  describe("after the person confirms", () => {
    it("posts once more with the proof and the same ids and text", async () => {
      const outcome = await changes.sendMessage(ALL, ARGS);
      expect(deps.post).toHaveBeenCalledTimes(2);
      expect(deps.post.mock.calls[1]).toEqual([
        { workspaceId: "w1", channelId: "c1", text: TEXT, proof: PROOF },
      ]);
      expect(outcome).toEqual({
        isError: false,
        payload: { outcome: "sent", channelId: "c1", messageId: "m1" },
      });
    });

    it("records the message's id, and never the text", async () => {
      await changes.sendMessage(ALL, ARGS);
      expect(changesRecorded()).toEqual(["asked", "sent"]);
      expect(entries[1]).toMatchObject({ messageIds: ["m1"], refused: false });
    });

    it.each([
      ["no payload", null],
      ["a payload with no id", { conversation_id: "c1" }],
      ["an id that is no string", { message_id: 7 }],
    ])("answers a null id for %s", async (_what, payload) => {
      deps.post.mockResolvedValue(posted(payload));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual({
        isError: false,
        payload: { outcome: "sent", channelId: "c1", messageId: null },
      });
      expect(entries[1].messageIds).toEqual([]);
    });

    it("still answers sent when that last record fails, and logs no text", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      deps.record.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(TEXT));
      const outcome = await changes.sendMessage(ALL, ARGS);
      expect(outcome).toMatchObject({ isError: false, payload: { outcome: "sent" } });
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TEXT);
    });

    it("does not post when the agent was disconnected during the dialog", async () => {
      deps.connected.mockReturnValueOnce(true).mockReturnValue(false);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(DENIED);
      expect(proofs()).toEqual([undefined]);
      expect(changesRecorded()).toEqual(["asked", "refused"]);
      expect(entries[1].refused).toBe(true);
    });

    it("answers a stale proof as an expiry, with its cooldown", async () => {
      deps.post.mockRejectedValueOnce(serverError("CONFIRMATION_STALE", "stale"));
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(EXPIRED);
      expect(changesRecorded()).toEqual(["asked", "expired"]);
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(COOLING_DOWN);
    });

    it("answers another refusal in the server's words", async () => {
      deps.post.mockRejectedValueOnce(
        serverError("FORBIDDEN", "permission denied", { refusal: "DENIED" }),
      );
      expect(await changes.sendMessage(ALL, ARGS)).toMatchObject({
        isError: true,
        payload: { refusal: "DENIED", retrySafe: false },
      });
      expect(changesRecorded()).toEqual(["asked", "refused"]);
    });

    it("does not call a failure it cannot read safe to retry", async () => {
      deps.post.mockRejectedValueOnce(new TypeError("failed to fetch"));
      expect(await changes.sendMessage(ALL, ARGS)).toMatchObject({
        payload: { refusal: "FAILED", retrySafe: false },
      });
    });

    it("refuses a second challenge rather than asking again", async () => {
      deps.post.mockResolvedValueOnce(held());
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(FAILED);
      expect(deps.confirm).toHaveBeenCalledOnce();
      expect(deps.post).toHaveBeenCalledTimes(2);
      expect(changesRecorded()).toEqual(["asked", "refused"]);
    });

    it("never uses one proof twice, nor a proof the person did not give", async () => {
      await changes.sendMessage(ALL, ARGS);
      expect(proofs()).toEqual([undefined, PROOF]);
    });
  });

  describe("the cooldown", () => {
    const SECOND_AGENT = agentWith({ w1: { all: true, channelIds: [] } }, "agent-2");

    async function discardOnce() {
      deps.confirm.mockResolvedValueOnce("discarded");
      await changes.sendMessage(ALL, ARGS);
      deps.post.mockReset();
      deps.post.mockResolvedValueOnce(held()).mockResolvedValue(posted());
      deps.record.mockClear();
      deps.confirm.mockClear();
    }

    it("turns away the next request within ten seconds of a discard, unrecorded", async () => {
      await discardOnce();
      clock += 9_999;
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(COOLING_DOWN);
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.post).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
    });

    it("lets it through at ten seconds", async () => {
      await discardOnce();
      clock += 10_000;
      expect(await changes.sendMessage(ALL, ARGS)).toMatchObject({ isError: false });
      expect(deps.confirm).toHaveBeenCalledOnce();
    });

    it("follows an expiry too", async () => {
      deps.confirm.mockImplementationOnce(() => {
        clock = EXPIRES_AT;
        return Promise.resolve("discarded");
      });
      await changes.sendMessage(ALL, ARGS);
      clock += 9_999;
      expect(await changes.sendMessage(ALL, ARGS)).toEqual(COOLING_DOWN);
    });

    it("does not follow a send", async () => {
      await changes.sendMessage(ALL, ARGS);
      deps.post.mockReset();
      deps.post.mockResolvedValueOnce(held()).mockResolvedValue(posted());
      expect(await changes.sendMessage(ALL, ARGS)).toMatchObject({ isError: false });
    });

    it("does not hold back a different agent", async () => {
      await discardOnce();
      expect(await changes.sendMessage(SECOND_AGENT, ARGS)).toMatchObject({ isError: false });
    });

    it("does not follow a refusal, and invalid calls during it stay invalid", async () => {
      await discardOnce();
      expect(await changes.sendMessage(ALL, { workspaceId: "w1" })).toEqual(INVALID);
    });
  });

  it("does not log the text on any path", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    deps.record.mockRejectedValue(new Error(TEXT));
    await changes.sendMessage(ALL, ARGS);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TEXT);
  });
});
