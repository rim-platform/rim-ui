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

import { useAuthStore } from "../../auth/state/useAuthStore";
import { postAsUser } from "./appMessageService";

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
