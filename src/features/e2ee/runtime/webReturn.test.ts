import { beforeEach, describe, expect, it, vi } from "vitest";

const web = vi.hoisted(() => ({ touchAccount: vi.fn(), groupsOf: vi.fn() }));
const groups = vi.hoisted(() => ({ askToBeReadded: vi.fn(), forgetGroup: vi.fn() }));
const fetchConversationGroup = vi.hoisted(() => vi.fn());
vi.mock("../web/webCommands", () => web);
vi.mock("./groups", () => groups);
vi.mock("../api/e2eeApi", () => ({ fetchConversationGroup }));

import { ABSENCE_MS, returnAfterAbsence } from "./webReturn";

const session = {
  account: {
    endpoint: "http://x/api",
    userId: "u-me",
    principalId: "rimp1_me",
    deviceId: "dev-me",
    web: true as const,
  },
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "dev-me",
};

function serverGroup(incarnation: number, deviceIds: string[]) {
  return {
    mlsGroup: {
      incarnation,
      devices: deviceIds.map((deviceId) => ({ principalId: "p", deviceId })),
    },
  };
}

describe("a browser coming back after an absence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    web.groupsOf.mockResolvedValue([
      { workspaceId: "ws", conversationId: "c-still", incarnation: 1 },
      { workspaceId: "ws", conversationId: "c-removed", incarnation: 1 },
      { workspaceId: "ws", conversationId: "c-none", incarnation: 0 },
    ]);
    fetchConversationGroup.mockImplementation(async (_ws: string, id: string) =>
      id === "c-still" ? serverGroup(1, ["DEV-ME", "other"]) : serverGroup(1, ["other"]),
    );
  });

  it("asks to be re-added where it still counts, and drops its state elsewhere", async () => {
    web.touchAccount.mockResolvedValue(Date.now() - ABSENCE_MS - 1);
    expect(await returnAfterAbsence(session)).toBe(true);
    expect(groups.askToBeReadded).toHaveBeenCalledWith(session, "ws", "c-still", 1);
    expect(groups.forgetGroup).toHaveBeenCalledWith(session, "ws", "c-removed");
    expect(groups.forgetGroup).toHaveBeenCalledTimes(1);
  });

  it("does nothing after a short break, the first time, or on the desktop", async () => {
    web.touchAccount.mockResolvedValue(Date.now() - ABSENCE_MS + 60_000);
    expect(await returnAfterAbsence(session)).toBe(false);
    web.touchAccount.mockResolvedValue(null);
    expect(await returnAfterAbsence(session)).toBe(false);
    expect(
      await returnAfterAbsence({ ...session, account: { endpoint: "x", userId: "u-me" } }),
    ).toBe(false);
    expect(groups.askToBeReadded).not.toHaveBeenCalled();
    expect(groups.forgetGroup).not.toHaveBeenCalled();
  });
});
