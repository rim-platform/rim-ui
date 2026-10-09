import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  ackWelcomes: vi.fn(),
  CIPHER_SUITE: 0x4f,
  claimKeyPackages: vi.fn(),
  fetchCommits: vi.fn(),
  fetchConversationGroup: vi.fn(),
  fetchKeyPackageStatus: vi.fn(),
  fetchWelcomes: vi.fn(),
  requestReadd: vi.fn(),
  submitCommit: vi.fn(),
  uploadKeyPackages: vi.fn(),
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
vi.mock("./members", () => ({
  conversationMembers: vi.fn(async () => [{ userId: "u-a", principalId: "rimp1_a" }]),
  directoryFor: vi.fn(async (members: string[]) => ({ members, principals: [] })),
  notReadyMembers: vi.fn(async () => ({ names: [], directory: [] })),
}));

import { commitPendingChanges, createGroup, processWelcomes, refreshKeyPackages } from "./groups";

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

function graphqlError(code: string) {
  return Object.assign(new Error(code), {
    response: { errors: [{ message: code, extensions: { code } }] },
  });
}

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
    api.fetchWelcomes.mockResolvedValue([]);

    expect(await createGroup(session, "ws", "c")).toBe(false);
    expect(commands.settleCommit.mock.calls[0][4]).toBe(false);
    expect(api.fetchWelcomes).toHaveBeenCalled();
  });
});

describe("processWelcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins, catches up, then acknowledges; a Welcome it cannot open asks for a re-add", async () => {
    api.fetchWelcomes.mockResolvedValue([
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
    expect(api.ackWelcomes).toHaveBeenCalledWith(["w1", "w2"]);
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
