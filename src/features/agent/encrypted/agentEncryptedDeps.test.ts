import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ current: "web" }));
const cache = vi.hoisted(() => ({
  current: null as null | { list: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> },
}));
const upgradeNewConversation = vi.hoisted(() => vi.fn());
vi.mock("../../../core/runtime/runtime", async (importActual) => ({
  ...(await importActual<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.current,
}));
vi.mock("../../plugins/chat/appMessageService", () => ({
  chatCache: () => cache.current,
  conversationEncrypted: vi.fn(),
  postAsUser: vi.fn(),
}));
vi.mock("../../e2ee/runtime/upgrade", () => ({ upgradeNewConversation }));
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: async () => ({ userId: "u" }) }));

import { agentEncryptedDeps } from "./agentEncryptedDeps";

describe("the agent's encrypted-conversation reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.current = "web";
    cache.current = {
      list: vi.fn(async () => ({ messages: [], hasOlder: false })),
      search: vi.fn(async () => []),
    };
  });

  it("read the store the message service reads, in a browser too", async () => {
    expect(await agentEncryptedDeps.list("ws", "c", 20)).toEqual({ messages: [], hasOlder: false });
    expect(cache.current?.list).toHaveBeenCalledWith("ws", "c", null, 20, {
      encryptedAllowed: true,
      knownEncrypted: ["c"],
    });
    await agentEncryptedDeps.search("ws", "plan", null, 10);
    expect(cache.current?.search).toHaveBeenCalledWith("ws", "plan", null, 10, {
      encryptedAllowed: true,
      knownEncrypted: [],
    });
  });

  it("answer nothing where the device keeps no messages", async () => {
    cache.current = null;
    expect(await agentEncryptedDeps.list("ws", "c", 20)).toBeNull();
    expect(await agentEncryptedDeps.search("ws", "plan", "c", 10)).toEqual([]);
  });

  it("leave the upgrade of a conversation to a desktop", async () => {
    await agentEncryptedDeps.upgrade("ws", "c");
    expect(upgradeNewConversation).not.toHaveBeenCalled();
    platform.current = "desktop";
    await agentEncryptedDeps.upgrade("ws", "c");
    expect(upgradeNewConversation).toHaveBeenCalledWith({ userId: "u" }, "ws", "c");
  });
});
