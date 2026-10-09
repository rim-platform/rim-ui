import { beforeEach, describe, expect, it, vi } from "vitest";

const groups = vi.hoisted(() => ({
  askToBeReadded: vi.fn(),
  invalidateTimeline: vi.fn(),
  processWelcomes: vi.fn(),
  refreshGroups: vi.fn(),
  refreshKeyPackages: vi.fn(),
  verifyLeaves: vi.fn(),
}));
const fetchConversationGroup = vi.hoisted(() => vi.fn());
const requestCacheSync = vi.hoisted(() => vi.fn());
const syncMembership = vi.hoisted(() => vi.fn());
vi.mock("./groups", () => groups);
vi.mock("../api/e2eeApi", () => ({ fetchConversationGroup }));
vi.mock("../../messages/runtime/messageCacheSync", () => ({
  requestCacheSync,
  setE2eeNoteHandler: vi.fn(),
}));
vi.mock("./membership", () => ({ syncMembership, cancelMembershipSyncs: vi.fn() }));
vi.mock("./session", () => ({
  e2eeSession: async () => session,
  resetE2eeSession: vi.fn(),
}));

import type { MlsSyncNote } from "../../messages/api/messageCache";
import { handleE2eeEvent, handleSyncNotes } from "./e2eeRuntime";

const session = {
  account: { endpoint: "http://x/api", userId: "u-me" },
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "dev-me",
};

function note(overrides: Partial<MlsSyncNote>): MlsSyncNote {
  return {
    conversationId: "c",
    stopped: null,
    verify: false,
    removed: false,
    misbehaved: false,
    decrypted: [],
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("handleSyncNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groups.refreshGroups.mockResolvedValue([]);
    groups.processWelcomes.mockResolvedValue([]);
    groups.verifyLeaves.mockResolvedValue({});
  });

  it("re-reads the timeline and checks new leaves", async () => {
    await handleSyncNotes(session.account, "ws", [note({ verify: true })]);
    expect(groups.invalidateTimeline).toHaveBeenCalledWith("ws", "c");
    expect(groups.verifyLeaves).toHaveBeenCalledWith(session, "ws", "c", false);
  });

  it("checks every leaf afresh after a Commit whose summary lied", async () => {
    await handleSyncNotes(session.account, "ws", [note({ misbehaved: true })]);
    expect(groups.verifyLeaves).toHaveBeenCalledWith(session, "ws", "c", true);
  });

  it("asks to be re-added when the server counts this device in but it holds no state", async () => {
    fetchConversationGroup.mockResolvedValue({
      mlsGroup: { incarnation: 1, devices: [{ deviceId: "DEV-ME" }] },
    });
    await handleSyncNotes(session.account, "ws", [
      note({ stopped: { kind: "noGroupState", incarnation: 1 } }),
    ]);
    expect(groups.processWelcomes).toHaveBeenCalled();
    expect(groups.askToBeReadded).toHaveBeenCalledWith(session, "ws", "c", 1);
    expect(requestCacheSync).not.toHaveBeenCalled();
  });

  it("syncs again with placeholders when this device is not in the group", async () => {
    fetchConversationGroup.mockResolvedValue({
      mlsGroup: { incarnation: 1, devices: [{ deviceId: "dev-other" }] },
    });
    await handleSyncNotes(session.account, "ws", [
      note({ stopped: { kind: "noGroupState", incarnation: 1 } }),
    ]);
    expect(groups.askToBeReadded).not.toHaveBeenCalled();
    expect(requestCacheSync).toHaveBeenCalledWith("ws", ["c"]);
  });

  it("sends a re-add request once when a Commit cannot be processed", async () => {
    groups.refreshGroups.mockResolvedValueOnce([{ readdRequestedAt: null }]);
    await handleSyncNotes(session.account, "ws", [
      note({ stopped: { kind: "awaitingReadd", incarnation: 1, epoch: 7 } }),
    ]);
    expect(groups.askToBeReadded).toHaveBeenCalledWith(session, "ws", "c", 1);

    vi.clearAllMocks();
    groups.refreshGroups.mockResolvedValue([{ readdRequestedAt: 1 }]);
    await handleSyncNotes(session.account, "ws", [
      note({ stopped: { kind: "awaitingReadd", incarnation: 1, epoch: 7 } }),
    ]);
    expect(groups.askToBeReadded).not.toHaveBeenCalled();
  });
});

describe("handleE2eeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groups.processWelcomes.mockResolvedValue([]);
    groups.verifyLeaves.mockResolvedValue({});
    syncMembership.mockResolvedValue(undefined);
  });

  it("joins on a Welcome for this device only", async () => {
    handleE2eeEvent(
      {
        type: "MlsWelcomeAvailable",
        workspace_id: "ws",
        conversation_id: "c",
        user_id: "u-me",
        device_id: "dev-other",
      },
      "ws",
    );
    await flush();
    expect(groups.processWelcomes).not.toHaveBeenCalled();

    handleE2eeEvent(
      {
        type: "MlsWelcomeAvailable",
        workspace_id: "ws",
        conversation_id: "c",
        user_id: "u-me",
        device_id: "dev-me",
      },
      "ws",
    );
    await flush();
    expect(groups.processWelcomes).toHaveBeenCalledWith(session);
  });

  it("only starts the loop on an accepted Commit", async () => {
    handleE2eeEvent(
      {
        type: "MlsCommitAccepted",
        workspace_id: "ws",
        conversation_id: "c",
        incarnation: 1,
        epoch: 3,
      },
      "ws",
    );
    await flush();
    expect(requestCacheSync).toHaveBeenCalledWith("ws", ["c"]);
  });

  it("rechecks the device list and schedules the commit on a membership change", async () => {
    handleE2eeEvent(
      { type: "MlsMembershipChanged", workspace_id: "ws", conversation_id: "c" },
      "ws",
    );
    await flush();
    await flush();
    expect(groups.verifyLeaves).toHaveBeenCalledWith(session, "ws", "c", true);
    expect(syncMembership).toHaveBeenCalledWith(session, "ws", "c");
  });
});
