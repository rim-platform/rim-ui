import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  ackWelcomes: vi.fn(),
  CIPHER_SUITE: 0x4f,
  claimKeyPackages: vi.fn(),
  fetchCommits: vi.fn(),
  fetchConversationGroup: vi.fn(),
  fetchKeyPackageStatus: vi.fn(),
  fetchWelcomePage: vi.fn(),
  requestReadd: vi.fn(),
  submitCommit: vi.fn(),
  uploadKeyPackages: vi.fn(),
  WELCOME_PAGE_SIZE: 100,
  welcomeSources: vi.fn((): (string | null)[] => [null]),
}));
const commands = vi.hoisted(() => ({
  status: vi.fn(),
  commit: vi.fn(),
  createGroup: vi.fn(),
  settleCommit: vi.fn(),
  processCommits: vi.fn(),
  join: vi.fn(),
  verify: vi.fn(),
  readdCheck: vi.fn(),
  readdRequest: vi.fn(),
  ensureIdentity: vi.fn(),
  keyPackages: vi.fn(),
}));
vi.mock("../api/e2eeApi", () => api);
vi.mock("../api/e2eeCommands", () => ({
  e2eeCommands: commands,
  E2eeCommandError: class extends Error {
    code = "E2EE_MLS";
  },
}));
vi.mock("../../messages/api/messageCache", () => ({ trackConversation: vi.fn() }));
vi.mock("../../messages/runtime/messageCacheSync", () => ({ syncNow: vi.fn() }));
const serverMembers = vi.hoisted(() => ({ fetchServerMembers: vi.fn() }));
vi.mock("../../workspaces/api/useServerMembers", () => serverMembers);
vi.mock("./members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./members")>()),
  directoryFor: vi.fn(async (members: string[]) => ({ members, principals: [] })),
  notReadyMembers: vi.fn(async () => ({ names: [], directory: [] })),
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { E2eeCommandError } from "../api/e2eeCommands";
import { useE2eeStore } from "../state/useE2eeStore";
import {
  commitPendingChanges,
  createGroup,
  createGroupLocked,
  MEMBER_WITHOUT_DEVICE,
  processWelcomes,
  TOO_MANY_PENDING_WELCOMES,
  refreshKeyPackages,
  verifyLeaves,
} from "./groups";
import { directoryFor, notReadyMembers } from "./members";

const session = {
  account: { endpoint: "http://x/api", userId: "u-me" },
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "dev-me",
};

function serverGroup(overrides: Record<string, unknown> = {}) {
  return {
    groupId: "g",
    incarnation: 1,
    cipherSuite: 0x4f,
    epoch: 4,
    devices: [{ principalId: "rimp1_me", deviceId: "dev-me", userId: "u-me", addedEpoch: 0 }],
    pendingAdds: [],
    pendingRemoves: [],
    readdRequests: [],
    ...overrides,
  };
}

function graphqlError(code: string, message = code) {
  return Object.assign(new Error(message), {
    response: { errors: [{ message, extensions: { code } }] },
  });
}

const alice = { userId: "u-a", username: "alice", principalId: "rimp1_a" };
const bob = { userId: "u-b", username: "bob", principalId: "rimp1_b" };

/** A directory where every principal asked about has one device set up for encryption. */
function readyDirectory(members: string[], principals: string[]) {
  return Promise.resolve({
    members,
    principals: principals.map((principalId) => ({
      principalId,
      keyLog: [],
      devices: [{ deviceId: `dev-${principalId}`, mlsActive: true, revokedAt: null } as never],
    })),
  });
}

beforeEach(() => {
  queryClient.clear();
  serverMembers.fetchServerMembers.mockResolvedValue([alice]);
});

const outgoing = {
  incarnation: 1,
  epoch: 4,
  cipherSuite: 0x4f,
  commit: "commit-bytes",
  welcome: "welcome-bytes",
  adds: [],
  removes: [],
};

describe("commitPendingChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commands.status.mockResolvedValue([
      { conversationId: "c", hasGroup: true, incarnation: 1, epoch: 4 },
    ]);
    commands.commit.mockResolvedValue(outgoing);
    commands.readdCheck.mockResolvedValue([]);
  });

  it("claims pending adds and commits them with the pending removes at once", async () => {
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: ["u-me", "u-a"],
      mlsGroup: serverGroup({
        pendingAdds: [
          { principalId: "rimp1_a", deviceId: "dev-a", userId: "u-a", hasKeyPackage: true },
          { principalId: "rimp1_a", deviceId: "dev-a2", userId: "u-a", hasKeyPackage: false },
        ],
        pendingRemoves: [
          { principalId: "rimp1_x", deviceId: "dev-x", userId: "u-x", addedEpoch: 1 },
        ],
      }),
    });
    api.claimKeyPackages.mockResolvedValue([
      { principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp", userId: "u-a" },
    ]);
    api.submitCommit.mockResolvedValue(undefined);

    expect(await commitPendingChanges(session, "ws", "c")).toBe(true);

    expect(api.claimKeyPackages).toHaveBeenCalledWith("ws", "c", [
      { principalId: "rimp1_a", deviceId: "dev-a" },
    ]);
    expect(commands.commit).toHaveBeenCalledWith(
      session.account,
      "ws",
      "c",
      [{ principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp" }],
      [{ principalId: "rimp1_x", deviceId: "dev-x" }],
    );
    expect(api.submitCommit).toHaveBeenCalledWith({
      serverId: "ws",
      conversationId: "c",
      incarnation: 1,
      epoch: 4,
      cipherSuite: null,
      commit: "commit-bytes",
      welcome: "welcome-bytes",
    });
    expect(commands.settleCommit).toHaveBeenCalledWith(
      session.account,
      "rimp1_me",
      "ws",
      "c",
      true,
      [],
    );
  });

  it("claims the adds alone when a re-add target has no fresh key package yet", async () => {
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: ["u-me", "u-a"],
      mlsGroup: serverGroup({
        pendingAdds: [
          { principalId: "rimp1_a", deviceId: "dev-a", userId: "u-a", hasKeyPackage: true },
        ],
        readdRequests: [
          {
            principalId: "rimp1_b",
            deviceId: "dev-b",
            request: { payload: "p", signature: "s" },
            createdAt: "2026-10-09T00:00:00Z",
          },
        ],
      }),
    });
    commands.readdCheck.mockResolvedValue([{ principalId: "rimp1_b", deviceId: "dev-b" }]);
    api.claimKeyPackages
      .mockRejectedValueOnce(graphqlError("VALIDATION"))
      .mockResolvedValueOnce([
        { principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp", userId: "u-a" },
      ]);
    api.submitCommit.mockResolvedValue(undefined);

    expect(await commitPendingChanges(session, "ws", "c")).toBe(true);
    expect(api.claimKeyPackages.mock.calls[1][2]).toEqual([
      { principalId: "rimp1_a", deviceId: "dev-a" },
    ]);
    // The re-add is neither removed nor added in this Commit.
    expect(commands.commit.mock.calls[0][4]).toEqual([]);
    expect(commands.settleCommit.mock.calls[0][5]).toEqual([]);
  });

  it("drops its Commit on STALE_EPOCH, catches up and tries again", async () => {
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: [],
      mlsGroup: serverGroup({
        pendingRemoves: [
          { principalId: "rimp1_x", deviceId: "dev-x", userId: "u-x", addedEpoch: 1 },
        ],
      }),
    });
    api.claimKeyPackages.mockResolvedValue([]);
    api.submitCommit
      .mockRejectedValueOnce(graphqlError("STALE_EPOCH"))
      .mockResolvedValue(undefined);

    expect(await commitPendingChanges(session, "ws", "c")).toBe(true);
    expect(commands.settleCommit.mock.calls[0][4]).toBe(false);
    expect(commands.settleCommit.mock.calls[1][4]).toBe(true);
    expect(api.submitCommit).toHaveBeenCalledTimes(2);
  });

  it("settles a Commit that got no answer by the Commit the server holds", async () => {
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: [],
      mlsGroup: serverGroup({
        pendingRemoves: [
          { principalId: "rimp1_x", deviceId: "dev-x", userId: "u-x", addedEpoch: 1 },
        ],
      }),
    });
    api.claimKeyPackages.mockResolvedValue([]);
    api.submitCommit.mockRejectedValue(new Error("network down"));
    api.fetchCommits.mockResolvedValue([{ incarnation: 1, epoch: 4, message: "commit-bytes" }]);

    expect(await commitPendingChanges(session, "ws", "c")).toBe(true);
    expect(commands.processCommits).toHaveBeenCalledWith(session.account, "ws", "c", [
      { incarnation: 1, epoch: 4, message: "commit-bytes" },
    ]);
    expect(commands.settleCommit).not.toHaveBeenCalled();
  });

  describe("when an added device has no room for one more Welcome", () => {
    const full = () =>
      graphqlError("VALIDATION", `device dev-a of rimp1_a ${TOO_MANY_PENDING_WELCOMES}`);
    const devA = { principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp", userId: "u-a" };

    beforeEach(() => {
      api.fetchConversationGroup.mockResolvedValue({
        memberIds: ["u-me", "u-a"],
        mlsGroup: serverGroup({
          pendingAdds: [
            { principalId: "rimp1_a", deviceId: "dev-a", userId: "u-a", hasKeyPackage: true },
          ],
        }),
      });
    });

    it("drops the Commit and commits nothing once the claim leaves the device out", async () => {
      api.claimKeyPackages.mockResolvedValueOnce([devA]).mockResolvedValueOnce([]);
      api.submitCommit.mockRejectedValueOnce(full());

      expect(await commitPendingChanges(session, "ws", "c")).toBe(false);
      expect(commands.settleCommit).toHaveBeenCalledTimes(1);
      expect(commands.settleCommit.mock.calls[0][4]).toBe(false);
      expect(api.claimKeyPackages).toHaveBeenCalledTimes(2);
      expect(commands.commit).toHaveBeenCalledTimes(1);
      expect(api.submitCommit).toHaveBeenCalledTimes(1);
    });

    it("commits the other pending changes without the device", async () => {
      api.fetchConversationGroup.mockResolvedValue({
        memberIds: ["u-me", "u-a"],
        mlsGroup: serverGroup({
          pendingAdds: [
            { principalId: "rimp1_a", deviceId: "dev-a", userId: "u-a", hasKeyPackage: true },
          ],
          pendingRemoves: [
            { principalId: "rimp1_x", deviceId: "dev-x", userId: "u-x", addedEpoch: 1 },
          ],
        }),
      });
      api.claimKeyPackages.mockResolvedValueOnce([devA]).mockResolvedValueOnce([]);
      api.submitCommit.mockRejectedValueOnce(full()).mockResolvedValueOnce(undefined);

      expect(await commitPendingChanges(session, "ws", "c")).toBe(true);
      expect(commands.commit.mock.calls[1][3]).toEqual([]);
      expect(commands.commit.mock.calls[1][4]).toEqual([
        { principalId: "rimp1_x", deviceId: "dev-x" },
      ]);
      expect(commands.settleCommit.mock.calls.map((call) => call[4])).toEqual([false, true]);
    });

    it("gives up after 3 refused Commits", async () => {
      api.claimKeyPackages.mockResolvedValue([devA]);
      api.submitCommit.mockRejectedValue(full());

      expect(await commitPendingChanges(session, "ws", "c")).toBe(false);
      expect(api.submitCommit).toHaveBeenCalledTimes(3);
      expect(commands.settleCommit.mock.calls.map((call) => call[4])).toEqual([
        false,
        false,
        false,
      ]);
    });
  });

  it("does nothing while this device is behind the server's epoch", async () => {
    commands.status.mockResolvedValue([
      { conversationId: "c", hasGroup: true, incarnation: 1, epoch: 3 },
    ]);
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: [],
      mlsGroup: serverGroup({
        pendingRemoves: [
          { principalId: "rimp1_x", deviceId: "dev-x", userId: "u-x", addedEpoch: 1 },
        ],
      }),
    });
    expect(await commitPendingChanges(session, "ws", "c")).toBe(false);
    expect(commands.commit).not.toHaveBeenCalled();
  });
});

describe("a direct message under a misbehaving server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useE2eeStore.getState().clear();
    commands.commit.mockResolvedValue(outgoing);
    commands.readdCheck.mockResolvedValue([]);
    api.submitCommit.mockResolvedValue(undefined);
  });

  it("finding 4: never commits an add outside its two pinned principals, and says so", async () => {
    commands.status.mockResolvedValue([
      {
        conversationId: "c",
        hasGroup: true,
        incarnation: 1,
        epoch: 4,
        pinned: true,
        pinnedEncryptedAt: "2026-10-09T00:00:00Z",
        dmPrincipals: ["rimp1_a", "rimp1_me"],
      },
    ]);
    api.fetchConversationGroup.mockResolvedValue({
      id: "c",
      conversationType: "DIRECT",
      memberIds: ["u-me", "u-a", "u-m"],
      encryptedAt: "2026-10-09T00:00:00Z",
      mlsGroup: serverGroup({
        pendingAdds: [
          { principalId: "rimp1_a", deviceId: "dev-a2", userId: "u-a", hasKeyPackage: true },
          { principalId: "rimp1_mallory", deviceId: "dev-m", userId: "u-m", hasKeyPackage: true },
        ],
      }),
    });
    api.claimKeyPackages.mockResolvedValue([
      { principalId: "rimp1_a", deviceId: "dev-a2", keyPackage: "kp", userId: "u-a" },
    ]);

    expect(await commitPendingChanges(session, "ws", "c")).toBe(true);
    expect(api.claimKeyPackages).toHaveBeenCalledWith("ws", "c", [
      { principalId: "rimp1_a", deviceId: "dev-a2" },
    ]);
    expect(useE2eeStore.getState().refusedAdds.c).toEqual(["rimp1_mallory"]);
  });

  it("finding 4: does not create a direct message's group with a third principal", async () => {
    commands.status.mockResolvedValue([{ conversationId: "c", pinned: false }]);
    api.fetchConversationGroup.mockResolvedValue({
      id: "c",
      conversationType: "DIRECT",
      memberIds: ["u-me", "u-a", "u-m"],
      encryptedAt: null,
      mlsGroup: null,
    });
    const { directoryFor } = await import("./members");
    vi.mocked(directoryFor).mockResolvedValueOnce({
      members: [],
      principals: ["rimp1_a", "rimp1_mallory"].map((principalId) => ({
        principalId,
        keyLog: [],
        devices: [{ deviceId: `dev-${principalId}`, mlsActive: true, revokedAt: null } as never],
      })),
    });
    api.claimKeyPackages.mockResolvedValue([]);
    commands.createGroup.mockResolvedValue({ ...outgoing, epoch: 0 });

    await createGroup(session, "ws", "c");
    expect(api.claimKeyPackages).toHaveBeenCalledWith("ws", "c", []);
  });

  it("finding 6: a stale or replayed Welcome is acknowledged without asking for a re-add", async () => {
    api.fetchWelcomePage.mockResolvedValue([
      { id: "w1", serverId: "ws", conversationId: "c1", incarnation: 1, epoch: 1, message: "a" },
      { id: "w2", serverId: "ws", conversationId: "c2", incarnation: 1, epoch: 1, message: "b" },
    ]);
    const stale = Object.assign(new E2eeCommandError("E2EE_STALE_WELCOME", "replayed"), {
      code: "E2EE_STALE_WELCOME",
    });
    commands.join.mockRejectedValueOnce(stale).mockRejectedValueOnce(new Error("no key package"));
    // The device holds working state of c2's incarnation: the Welcome is a leftover.
    commands.status.mockResolvedValue([
      {
        conversationId: "c2",
        hasGroup: true,
        incarnation: 1,
        awaitingReadd: null,
        readdRequestedAt: null,
      },
    ]);

    expect(await processWelcomes(session)).toEqual([]);
    expect(commands.readdRequest).not.toHaveBeenCalled();
    expect(api.requestReadd).not.toHaveBeenCalled();
    expect(api.ackWelcomes).toHaveBeenCalledWith(null, ["w1", "w2"]);
  });
});

describe("createGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commands.status.mockResolvedValue([{ conversationId: "c" }]);
    api.submitCommit.mockResolvedValue(undefined);
  });

  it("creates incarnation 1 with every ready device but its own", async () => {
    const { directoryFor } = await import("./members");
    vi.mocked(directoryFor).mockResolvedValueOnce({
      members: ["rimp1_a"],
      principals: [
        {
          principalId: "rimp1_a",
          keyLog: [],
          devices: [
            { deviceId: "dev-a", mlsActive: true, revokedAt: null } as never,
            { deviceId: "dev-old", mlsActive: false, revokedAt: null } as never,
            { deviceId: "dev-me", mlsActive: true, revokedAt: null } as never,
          ],
        },
      ],
    });
    api.fetchConversationGroup.mockResolvedValue({ memberIds: ["u-me", "u-a"], mlsGroup: null });
    api.claimKeyPackages.mockResolvedValue([
      { principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp", userId: "u-a" },
    ]);
    commands.createGroup.mockResolvedValue({ ...outgoing, epoch: 0 });

    expect(await createGroup(session, "ws", "c")).toBe(true);
    expect(api.claimKeyPackages).toHaveBeenCalledWith("ws", "c", [
      { principalId: "rimp1_a", deviceId: "dev-a" },
    ]);
    expect(commands.createGroup).toHaveBeenCalledWith(session.account, "ws", "c", 1, [
      { principalId: "rimp1_a", deviceId: "dev-a", keyPackage: "kp" },
    ]);
    expect(api.submitCommit.mock.calls[0][0]).toMatchObject({ epoch: 0, cipherSuite: 0x4f });
  });

  it("leaves a conversation that has a group alone", async () => {
    api.fetchConversationGroup.mockResolvedValue({ memberIds: [], mlsGroup: serverGroup() });
    expect(await createGroup(session, "ws", "c")).toBe(false);
    expect(commands.createGroup).not.toHaveBeenCalled();
  });

  it("joins through the winner's Welcome when another device created it first", async () => {
    api.fetchConversationGroup.mockResolvedValue({ memberIds: ["u-me"], mlsGroup: null });
    api.claimKeyPackages.mockResolvedValue([]);
    commands.createGroup.mockResolvedValue({ ...outgoing, epoch: 0 });
    api.submitCommit.mockRejectedValue(graphqlError("STALE_EPOCH"));
    api.fetchWelcomePage.mockResolvedValue([]);

    expect(await createGroup(session, "ws", "c")).toBe(false);
    expect(commands.settleCommit.mock.calls[0][4]).toBe(false);
    expect(api.fetchWelcomePage).toHaveBeenCalledWith(null, null);
  });

  describe("with a member who joined after the member list was cached", () => {
    beforeEach(() => {
      queryClient.setQueryData(queryKeys.serverMembers("ws"), [alice]);
      serverMembers.fetchServerMembers.mockResolvedValue([alice, bob]);
      vi.mocked(directoryFor).mockImplementation(readyDirectory);
      api.fetchConversationGroup.mockResolvedValue({
        memberIds: ["u-me", "u-a", "u-b"],
        mlsGroup: null,
      });
      api.claimKeyPackages.mockResolvedValue([]);
      commands.createGroup.mockResolvedValue({ ...outgoing, epoch: 0 });
    });

    it("builds the first group from the member list fetched now, and caches it", async () => {
      expect(await createGroup(session, "ws", "c")).toBe(true);
      expect(api.claimKeyPackages).toHaveBeenCalledWith("ws", "c", [
        { principalId: "rimp1_a", deviceId: "dev-rimp1_a" },
        { principalId: "rimp1_b", deviceId: "dev-rimp1_b" },
      ]);
      expect(queryClient.getQueryData(queryKeys.serverMembers("ws"))).toEqual([alice, bob]);
    });

    it("builds the first Commit once more when the server says it leaves a member out", async () => {
      api.submitCommit
        .mockRejectedValueOnce(graphqlError("VALIDATION", MEMBER_WITHOUT_DEVICE))
        .mockResolvedValueOnce(undefined);

      expect(await createGroup(session, "ws", "c")).toBe(true);
      expect(api.submitCommit).toHaveBeenCalledTimes(2);
      expect(serverMembers.fetchServerMembers).toHaveBeenCalledTimes(2);
      expect(commands.settleCommit.mock.calls.map((call) => call[4])).toEqual([false, true]);
    });

    it.each([
      ["another validation error", graphqlError("VALIDATION", "a group holds at most 2 devices")],
      ["another code", graphqlError("FORBIDDEN", MEMBER_WITHOUT_DEVICE)],
    ])("does not build it again after %s", async (_reason, refusal) => {
      api.submitCommit.mockRejectedValueOnce(refusal);

      expect(await createGroupLocked(session, "ws", "c")).toEqual({
        created: false,
        notReady: [],
      });
      expect(api.submitCommit).toHaveBeenCalledTimes(1);
      expect(notReadyMembers).not.toHaveBeenCalled();
    });

    it("builds the first Commit once more when an added device has no room for the Welcome", async () => {
      api.submitCommit
        .mockRejectedValueOnce(
          graphqlError("VALIDATION", `device d of p ${TOO_MANY_PENDING_WELCOMES}`),
        )
        .mockResolvedValueOnce(undefined);

      expect(await createGroup(session, "ws", "c")).toBe(true);
      expect(api.submitCommit).toHaveBeenCalledTimes(2);
      expect(commands.settleCommit.mock.calls.map((call) => call[4])).toEqual([false, true]);
    });

    it("stops after the second Commit is refused for a full device too", async () => {
      api.submitCommit.mockRejectedValue(
        graphqlError("VALIDATION", `device d of p ${TOO_MANY_PENDING_WELCOMES}`),
      );

      expect(await createGroupLocked(session, "ws", "c")).toEqual({
        created: false,
        notReady: [],
      });
      expect(api.submitCommit).toHaveBeenCalledTimes(2);
      expect(notReadyMembers).not.toHaveBeenCalled();
    });

    it("names the other members who are not ready when the second Commit is refused too", async () => {
      serverMembers.fetchServerMembers.mockResolvedValue([
        { userId: "u-me", username: "me", principalId: "rimp1_me" },
        alice,
        bob,
      ]);
      api.submitCommit.mockRejectedValue(graphqlError("VALIDATION", MEMBER_WITHOUT_DEVICE));
      vi.mocked(notReadyMembers).mockResolvedValueOnce({ names: ["bob"], directory: [] });

      expect(await createGroupLocked(session, "ws", "c")).toEqual({
        created: false,
        notReady: ["bob"],
      });
      expect(api.submitCommit).toHaveBeenCalledTimes(2);
      expect(notReadyMembers).toHaveBeenCalledWith([alice, bob]);
    });
  });
});

describe("verifyLeaves", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks a leaf that fails once more against a member list fetched again", async () => {
    queryClient.setQueryData(queryKeys.serverMembers("ws"), [alice]);
    serverMembers.fetchServerMembers.mockResolvedValue([alice, bob]);
    api.fetchConversationGroup.mockResolvedValue({
      memberIds: ["u-me", "u-a", "u-b"],
      mlsGroup: serverGroup(),
    });
    commands.status.mockResolvedValue([{ conversationId: "c" }]);
    commands.verify
      .mockResolvedValueOnce({
        missing: [],
        unverified: [{ principalId: "rimp1_b", deviceId: "d" }],
      })
      .mockResolvedValueOnce({ missing: [], unverified: [] });

    await verifyLeaves(session, "ws", "c");

    expect(vi.mocked(directoryFor).mock.calls[1]).toEqual([["rimp1_a", "rimp1_b"], ["rimp1_b"]]);
    expect(commands.commit).not.toHaveBeenCalled();
  });
});

describe("processWelcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins, catches up, then acknowledges; a Welcome it cannot open asks for a re-add", async () => {
    api.fetchWelcomePage.mockResolvedValue([
      { id: "w1", serverId: "ws", conversationId: "c1", incarnation: 1, epoch: 1, message: "a" },
      { id: "w2", serverId: "ws", conversationId: "c2", incarnation: 1, epoch: 5, message: "b" },
    ]);
    commands.join.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("no key package"));
    commands.readdRequest.mockResolvedValue({ payload: "p", signature: "s" });
    commands.status.mockResolvedValue([{ conversationId: "c" }]);
    commands.keyPackages.mockResolvedValue([]);
    api.fetchConversationGroup.mockResolvedValue({ memberIds: [], mlsGroup: null });
    commands.verify.mockResolvedValue({ missing: [], unverified: [] });
    api.fetchKeyPackageStatus.mockResolvedValue(null);
    api.requestReadd.mockResolvedValue(undefined);

    expect(await processWelcomes(session)).toEqual(["c1"]);
    expect(api.requestReadd).toHaveBeenCalledWith("ws", "c2", { payload: "p", signature: "s" });
    // Fresh one-time packages only after the request, for the re-add to use.
    expect(commands.keyPackages).toHaveBeenCalledWith(session.account, null, 5);
    expect(api.requestReadd.mock.invocationCallOrder[0]).toBeLessThan(
      commands.keyPackages.mock.invocationCallOrder[0],
    );
    expect(api.ackWelcomes).toHaveBeenCalledWith(null, ["w1", "w2"]);
  });

  describe("a page at a time", () => {
    const stale = () =>
      Object.assign(new E2eeCommandError("E2EE_STALE_WELCOME", "replayed"), {
        code: "E2EE_STALE_WELCOME",
      });
    const welcome = (n: number) => ({
      id: `w${n}`,
      serverId: "ws",
      conversationId: `c${n}`,
      incarnation: 1,
      epoch: 1,
      message: "m",
      createdAt: `2026-10-20T00:00:00.${String(n).padStart(3, "0")}Z`,
    });
    const range = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => welcome(from + i));

    beforeEach(() => {
      commands.join.mockRejectedValue(stale());
      commands.status.mockResolvedValue([]);
    });

    it("reads past each full page and acknowledges each page on its own", async () => {
      api.fetchWelcomePage
        .mockResolvedValueOnce(range(0, 100))
        .mockResolvedValueOnce(range(100, 200))
        .mockResolvedValueOnce(range(200, 250));

      expect(await processWelcomes(session)).toEqual([]);
      expect(api.fetchWelcomePage.mock.calls).toEqual([
        [null, null],
        [null, welcome(99)],
        [null, welcome(199)],
      ]);
      expect(api.ackWelcomes.mock.calls).toEqual([
        [null, range(0, 100).map((w) => w.id)],
        [null, range(100, 200).map((w) => w.id)],
        [null, range(200, 250).map((w) => w.id)],
      ]);
      expect(commands.join).toHaveBeenCalledTimes(250);
    });

    it("reads at most 3 pages from a server in one pass", async () => {
      let next = 0;
      api.fetchWelcomePage.mockImplementation(async () => {
        next += 100;
        return range(next - 100, next);
      });

      await processWelcomes(session);
      expect(api.fetchWelcomePage).toHaveBeenCalledTimes(3);
      expect(api.ackWelcomes).toHaveBeenCalledTimes(3);
    });

    it("stops reading a server whose acknowledgement fails", async () => {
      api.fetchWelcomePage.mockResolvedValue(range(0, 100));
      api.ackWelcomes.mockRejectedValueOnce(new Error("network down"));

      await expect(processWelcomes(session)).rejects.toThrow("network down");
      expect(api.fetchWelcomePage).toHaveBeenCalledTimes(1);
    });

    it("reads each other host after this relay, and skips one that does not answer", async () => {
      api.welcomeSources.mockReturnValueOnce([null, "host-b", "host-c"]);
      api.fetchWelcomePage.mockImplementation(async (host: string | null) => {
        if (host === "host-b") throw new Error("unreachable");
        return host === null ? [welcome(1)] : [welcome(2)];
      });

      await processWelcomes(session);
      expect(api.fetchWelcomePage.mock.calls.map((call) => call[0])).toEqual([
        null,
        "host-b",
        "host-c",
      ]);
      expect(api.ackWelcomes.mock.calls).toEqual([
        [null, ["w1"]],
        ["host-c", ["w2"]],
      ]);
    });
  });
});

describe("refreshKeyPackages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes sure of the identity and uploads what the status calls for", async () => {
    const status = {
      cipherSuite: 0x4f,
      available: 3,
      lastResortNotAfter: null,
      lastResortClaims: 0,
    };
    api.fetchKeyPackageStatus.mockResolvedValue(status);
    commands.keyPackages.mockResolvedValue(["kp1", "kp2"]);
    await refreshKeyPackages(session);
    expect(commands.ensureIdentity).toHaveBeenCalledWith(session.account, "rimp1_me");
    expect(commands.keyPackages).toHaveBeenCalledWith(session.account, status, 0);
    expect(api.uploadKeyPackages).toHaveBeenCalledWith(["kp1", "kp2"]);
  });
});
