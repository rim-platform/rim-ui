import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as unknown }));
const sendEncrypted = vi.hoisted(() => vi.fn(async () => "msg-new"));
const request = vi.hoisted(() => vi.fn());
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: async () => session.current }));
vi.mock("../../e2ee/runtime/send", () => ({ sendEncrypted }));
vi.mock("../../e2ee/runtime/members", () => ({
  workspaceMembers: async () => [
    {
      userId: "u-me",
      username: "me",
      displayName: "Me",
      avatarUrl: null,
      principalId: "rimp1_me",
    },
  ],
}));
vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request } }));
const sync = vi.hoisted(() => ({
  trackConversation: vi.fn(async () => {}),
  syncNow: vi.fn(async () => true),
  requestCacheSync: vi.fn(),
}));
vi.mock("../../messages/api/messageCache", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackConversation: sync.trackConversation,
}));
vi.mock("../../messages/runtime/messageCacheSync", () => ({
  syncNow: sync.syncNow,
  requestCacheSync: sync.requestCacheSync,
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import type { WebAccount } from "../../e2ee/web/webAccount";
import { FOLLOW_WAIT_MS, postAsUser, webChatCache } from "./appMessageService";

const webAccount: WebAccount = {
  endpoint: "e",
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "d",
  web: true,
};

describe("following a conversation a plugin reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("tracks it and waits for its sync to finish", async () => {
    let finish: (synced: boolean) => void = () => {};
    sync.syncNow.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    let followed = false;
    const following = webChatCache(webAccount)
      .follow("ws", "c")
      .then(() => (followed = true));
    await vi.waitFor(() => expect(sync.syncNow).toHaveBeenCalledWith("ws", ["c"]));
    expect(sync.trackConversation).toHaveBeenCalledWith(webAccount, "ws", "c");
    expect(followed).toBe(false);
    finish(true);
    await following;
    expect(sync.requestCacheSync).not.toHaveBeenCalled();
  });

  it("stops waiting after a while and leaves a failed sync to the scheduler", async () => {
    vi.useFakeTimers();
    sync.syncNow.mockImplementationOnce(() => new Promise(() => {}));
    const slow = webChatCache(webAccount).follow("ws", "c");
    await vi.advanceTimersByTimeAsync(FOLLOW_WAIT_MS);
    await slow;

    sync.syncNow.mockRejectedValueOnce(new Error("offline"));
    await webChatCache(webAccount).follow("ws", "c");
    expect(sync.requestCacheSync).toHaveBeenCalledWith("ws", ["c"]);
  });
});

const post = {
  workspaceId: "ws",
  conversationId: "c",
  body: "hi <@rimp1_me>",
  threadId: null,
  encrypted: true,
};

describe("posting as the person in an encrypted conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().setSession({ userId: "u-me" });
  });

  it("goes through the encrypted send path on a device with an encryption session", async () => {
    session.current = {
      account: { endpoint: "e", userId: "u-me", principalId: "rimp1_me", deviceId: "d", web: true },
      userId: "u-me",
      principalId: "rimp1_me",
      deviceId: "d",
    };
    expect(await postAsUser(post)).toBe("msg-new");
    expect(sendEncrypted).toHaveBeenCalledWith(
      "ws",
      "c",
      expect.objectContaining({ body: "hi <@rimp1_me>", threadRootId: null }),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("is refused as noEncryption where the device has none, and never sent in plaintext", async () => {
    session.current = null;
    await expect(postAsUser(post)).rejects.toMatchObject({ data: { reason: "noEncryption" } });
    expect(sendEncrypted).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
