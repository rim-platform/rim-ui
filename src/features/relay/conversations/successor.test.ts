import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";
import { recordRelayFailure, recordRelaySuccess } from "../transport/relayHealth";

const start = vi.hoisted(() => ({ startDirectConversation: vi.fn() }));
vi.mock("./startDirect", () => start);

import { continueConversation, goneHome, HOME_GONE_MS } from "./successor";

beforeEach(() => {
  queryClient.clear();
  start.startDirectConversation.mockReset();
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [{ account: "a", spaceId: "home-direct", hostServerId: "rims1_home", kind: "direct" }],
    );
  recordRelaySuccess("rims1_home");
});

describe("goneHome", () => {
  it("is the host once it has failed for 7 days without an answer", () => {
    recordRelayFailure("rims1_home", 1_000);
    expect(goneHome("home-direct", 1_000 + HOME_GONE_MS - 1)).toBeNull();
    expect(goneHome("home-direct", 1_000 + HOME_GONE_MS)).toBe("rims1_home");
    expect(goneHome("direct-1", 1_000 + HOME_GONE_MS)).toBeNull();
    recordRelaySuccess("rims1_home");
    expect(goneHome("home-direct", 1_000 + HOME_GONE_MS)).toBeNull();
  });
});

describe("continueConversation", () => {
  it("starts a successor here with the other members, naming the old conversation", async () => {
    queryClient.setQueryData(queryKeys.conversation("home-direct", "old"), {
      memberIds: ["u1", "u2"],
    });
    queryClient.setQueryData(queryKeys.serverMembers("home-direct"), [
      { userId: "u1", username: "me", displayName: "Me", principalId: "rimp1_me" },
      { userId: "u2", username: "alice", displayName: "Alice", principalId: "rimp1_alice" },
      { userId: "u3", username: "other", displayName: "Other", principalId: "rimp1_other" },
    ]);
    start.startDirectConversation.mockResolvedValue({ spaceId: "direct-1", conversationId: "new" });
    await continueConversation("home-direct", "old");
    expect(start.startDirectConversation).toHaveBeenCalledWith(
      [{ principalId: "rimp1_alice", relayUrls: [], name: "Alice" }],
      { hostServerId: "rims1_home", conversationId: "old" },
    );
  });

  it("refuses a conversation this relay hosts", async () => {
    await expect(continueConversation("direct-1", "c")).rejects.toThrow(/hosted on this server/);
  });
});
