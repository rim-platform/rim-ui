import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";

const createGroup = vi.hoisted(() => vi.fn(async () => true));
const notReady = vi.hoisted(() => ({ names: [] as string[] }));
const groupInfo = vi.hoisted(() => vi.fn());
vi.mock("./groups", () => ({ createGroup }));
vi.mock("./members", () => ({
  conversationMembers: vi.fn(async () => []),
  notReadyMembers: vi.fn(async () => ({ names: notReady.names, directory: [] })),
}));
vi.mock("../api/e2eeApi", () => ({ fetchConversationGroup: groupInfo }));

import type { E2eeSession } from "./session";
import { upgradeEligible, upgradeIfReady, upgradeNewConversation } from "./upgrade";

const session: E2eeSession = {
  account: { endpoint: "http://localhost/api", userId: "me" },
  userId: "me",
  principalId: "rimp1_me",
  deviceId: "d-1",
};

const group = (overrides = {}) => ({
  id: "c-1",
  conversationType: ConversationTypeEnum.GROUP,
  memberIds: ["me", "ada"],
  createdBy: "me",
  encryptedAt: null,
  ...overrides,
});

beforeEach(() => {
  createGroup.mockClear();
  notReady.names = [];
});

describe("the upgrade of a plaintext DM or group", () => {
  it("is for either member of a DM and the creator of a group, or anyone once the creator left", () => {
    expect(
      upgradeEligible(
        group({ conversationType: ConversationTypeEnum.DIRECT, createdBy: "ada" }),
        "me",
      ),
    ).toBe(true);
    expect(upgradeEligible(group(), "me")).toBe(true);
    expect(upgradeEligible(group({ createdBy: "ada" }), "me")).toBe(false);
    expect(upgradeEligible(group({ createdBy: "gone" }), "me")).toBe(true);
    expect(upgradeEligible(group({ createdBy: null }), "me")).toBe(true);
    expect(upgradeEligible(group({ conversationType: ConversationTypeEnum.CHANNEL }), "me")).toBe(
      false,
    );
  });

  it("creates the group once every member is ready, and says who is not", async () => {
    expect(await upgradeIfReady(session, "ws-1", group())).toEqual([]);
    expect(createGroup).toHaveBeenCalledWith(session, "ws-1", "c-1");

    notReady.names = ["Ada"];
    createGroup.mockClear();
    expect(await upgradeIfReady(session, "ws-1", group())).toEqual(["Ada"]);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("does nothing for an encrypted conversation or when the caller stops it", async () => {
    await upgradeIfReady(session, "ws-1", group({ encryptedAt: "2026-10-01T00:00:00Z" }));
    await upgradeIfReady(session, "ws-1", group(), () => false);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("upgrades a group the agent just created on the server", async () => {
    groupInfo.mockResolvedValueOnce({ ...group({ id: "c-new" }), mlsGroup: null });
    await upgradeNewConversation(session, "ws-1", "c-new");
    expect(groupInfo).toHaveBeenCalledWith("ws-1", "c-new");
    expect(createGroup).toHaveBeenCalledWith(session, "ws-1", "c-new");
  });
});
