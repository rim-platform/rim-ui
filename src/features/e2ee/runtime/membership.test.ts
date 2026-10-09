import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchConversationGroup = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const groups = vi.hoisted(() => ({
  commitPendingChanges: vi.fn(),
  createGroup: vi.fn(),
  recoverIfStuck: vi.fn(),
}));
vi.mock("../api/e2eeApi", () => ({ fetchConversationGroup, CIPHER_SUITE: 0x4f }));
vi.mock("../api/e2eeCommands", () => ({ e2eeCommands: { status } }));
vi.mock("./groups", async () => {
  const actual = await vi.importActual<typeof import("./groups")>("./groups");
  return {
    ...groups,
    pendingChanges: actual.pendingChanges,
    needsSuiteMigration: actual.needsSuiteMigration,
  };
});
vi.mock("./session", () => ({ e2eeSession: async () => null }));

import { cancelMembershipSyncs, firstCommitter, syncMembership } from "./membership";

const session = {
  account: { endpoint: "http://x/api", userId: "u-me" },
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "00000000-0000-0000-0000-000000000002",
};

const device = (n: number, principalId = "rimp1_x") => ({
  principalId,
  deviceId: `00000000-0000-0000-0000-00000000000${n}`,
  userId: "u",
  addedEpoch: 0,
});

function info(group: Record<string, unknown> | null, encryptedAt = "2026-10-09T00:00:00Z") {
  return {
    id: "c",
    conversationType: "GROUP",
    memberIds: [],
    createdBy: null,
    encryptedAt,
    mlsGroup: group && {
      groupId: "g",
      incarnation: 1,
      cipherSuite: 0x4f,
      epoch: 3,
      devices: [device(1), device(2, "rimp1_me"), device(3)],
      pendingAdds: [],
      pendingRemoves: [],
      readdRequests: [],
      ...group,
    },
  };
}

describe("syncMembership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    status.mockResolvedValue([{ hasGroup: true, unverified: [], lastUpdateAt: Date.now() }]);
    groups.commitPendingChanges.mockResolvedValue(true);
    groups.createGroup.mockResolvedValue(true);
  });
  afterEach(() => {
    cancelMembershipSyncs();
    vi.useRealTimers();
  });

  it("waits its rank's delay, then commits", async () => {
    fetchConversationGroup.mockResolvedValue(
      info({ pendingAdds: [{ ...device(9, "rimp1_new"), hasKeyPackage: true }] }),
    );
    await syncMembership(session, "ws", "c");
    // Rank 1 of three devices: at least 15 s.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(groups.commitPendingChanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_001);
    expect(groups.commitPendingChanges).toHaveBeenCalledWith(session, "ws", "c");
  });

  it("commits at once for a change this device made", async () => {
    fetchConversationGroup.mockResolvedValue(info({ pendingRemoves: [device(3)] }));
    await syncMembership(session, "ws", "c", { immediate: true });
    expect(groups.commitPendingChanges).toHaveBeenCalled();
  });

  it("does nothing as a device pending removal", async () => {
    fetchConversationGroup.mockResolvedValue(info({ pendingRemoves: [device(2, "rimp1_me")] }));
    await syncMembership(session, "ws", "c", { immediate: true });
    expect(groups.commitPendingChanges).not.toHaveBeenCalled();
  });

  it("creates a group nobody created within a minute of the conversation", async () => {
    fetchConversationGroup.mockResolvedValue(
      info(null, new Date(Date.now() - 10_000).toISOString()),
    );
    await syncMembership(session, "ws", "c");
    expect(groups.createGroup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(groups.createGroup).toHaveBeenCalledWith(session, "ws", "c");
  });

  it("commits the weekly self-update once it falls due", async () => {
    status.mockResolvedValue([
      { hasGroup: true, unverified: [], lastUpdateAt: Date.now() - 9 * 24 * 3_600_000 },
    ]);
    fetchConversationGroup.mockResolvedValue(info({}));
    await syncMembership(session, "ws", "c");
    expect(groups.commitPendingChanges).toHaveBeenCalledWith(session, "ws", "c", {
      selfUpdate: true,
    });
  });

  it("leaves a plaintext conversation alone", async () => {
    fetchConversationGroup.mockResolvedValue({ ...info(null), encryptedAt: null });
    await syncMembership(session, "ws", "c", { immediate: true });
    expect(groups.createGroup).not.toHaveBeenCalled();
  });
});

describe("firstCommitter", () => {
  it("is the new device's owner's other device", () => {
    const group = info({
      devices: [device(5, "rimp1_bob"), device(4, "rimp1_bob"), device(1)],
      pendingAdds: [{ ...device(9, "rimp1_bob"), hasKeyPackage: true }],
    });
    expect(firstCommitter(group as never)).toBe(device(4).deviceId);
    expect(firstCommitter(info({}) as never)).toBeNull();
  });
});
